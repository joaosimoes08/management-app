# IPAM: RIPE paste/upload preview and NAT Site permissions

## RIPE paste/upload → preview diff → confirm import

Same two endpoints as before. No new route, no migration (`RipeImport.source`
already existed and is now set to `PASTE` for pasted lists).

Roles: `ADMIN`, `NETWORK_OPERATOR` (unchanged). When a `siteId` is given, the
preview also requires the `IMPORT` permission on that Site (the same permission
the import already required). A Site the user cannot read → 404; readable but
no `IMPORT` → 403.

### 1. Preview a pasted list — `POST /api/v1/ipam/ripe/preview`

Request:

```json
{
  "prefixes": ["193.0.0.0/21\n193.0.10.1/23", "2001:db8::/32, 10.0.0.0/24"],
  "siteId": "20000000-0000-4000-8000-000000000001",
  "vrfId": null,
  "purpose": "Public",
  "environment": "prod",
  "query": "Upload ripe-2026-11.txt"
}
```

| Field | Rules |
|---|---|
| `prefixes` | Required for a paste. Array of 1–500 strings. Each string may hold several prefixes separated by whitespace, newlines, commas or semicolons, so the UI can send the raw textarea/file content as one item. At most **500 prefixes in total** after splitting (`400 RIPE_PASTE_TOO_MANY`). |
| `siteId` | Required (UUID). The diff is computed against this Site. |
| `vrfId` | Optional UUID; must belong to `siteId` (`400 IPAM_PLACEMENT_SITE_MISMATCH`). Absent/null = no VRF. |
| `purpose`, `environment` | Optional (max 100 / 50). Only used to flag `changed`; send the same values to the import. |
| `query` | Optional label shown in the import history. Default `Lista colada (N prefixos)`. |

Each prefix must be IPv4 or IPv6 CIDR with an explicit length. Host bits are
normalised (`10.0.0.1/24` → `10.0.0.0/24`), IPv6 is lower-cased and compressed,
and duplicates (after normalising) are dropped. Invalid entries do not fail the
request; they are listed in `invalid`. If **no** entry is valid →
`400 RIPE_PASTE_NO_VALID_PREFIX` (with `details.invalid`).

Response `201`:

```json
{
  "id": "6f1d…",
  "query": "Upload ripe-2026-11.txt",
  "queryType": "paste",
  "source": "PASTE",
  "status": "PREVIEW",
  "prefixes": ["10.251.1.0/24", "10.251.2.0/24", "10.251.9.0/24", "10.250.2.0/24", "10.251.20.0/24", "2001:db8:251::/48"],
  "target": { "siteId": "2000…0001", "vrfId": null, "purpose": null, "environment": null },
  "summary": { "total": 6, "new": 2, "changed": 1, "exists": 1, "conflict": 2, "importable": 2, "invalid": 1, "duplicates": 1 },
  "diff": [
    { "prefix": "10.251.1.0/24", "input": "10.251.1.0/24", "version": 4, "status": "exists", "reason": "EXISTS_SAME", "importable": false,
      "message": "O prefixo já existe neste Site com os mesmos atributos.",
      "existing": { "id": "…", "cidr": "10.251.1.0/24", "siteId": "2000…0001", "vrfId": null, "purpose": "Users", "environment": null } },
    { "prefix": "10.251.2.0/24", "input": "10.251.2.0/24", "version": 4, "status": "changed", "reason": "EXISTS_DIFFERENT_ATTRIBUTES", "importable": false,
      "message": "O prefixo já existe neste Site com atributos diferentes; a importação não altera subnets existentes.",
      "existing": { "id": "…", "cidr": "10.251.2.0/24", "siteId": "2000…0001", "vrfId": "a1b2…", "purpose": null, "environment": null },
      "changes": [{ "field": "vrfId", "current": "a1b2…", "proposed": null }] },
    { "prefix": "10.251.9.0/24", "input": "10.251.9.0/24", "version": 4, "status": "conflict", "reason": "OVERLAP", "importable": false,
      "message": "Sobrepõe uma subnet existente no mesmo Site/VRF.",
      "overlaps": [{ "relation": "within", "sameScope": true, "subnet": { "id": "…", "cidr": "10.251.8.0/22", "siteId": "2000…0001", "vrfId": null, "purpose": null, "environment": null } }] },
    { "prefix": "10.250.2.0/24", "input": "10.250.2.0/24", "version": 4, "status": "conflict", "reason": "EXISTS_OUTSIDE_SITE", "importable": false,
      "message": "Este prefixo já existe noutro Site ou sem Site; os CIDR são únicos na aplicação.",
      "existing": { "id": null, "cidr": null, "hidden": true } },
    { "prefix": "10.251.20.0/24", "input": "10.251.20.1/24", "version": 4, "status": "new", "reason": "NEW", "importable": true, "message": "Prefixo novo." },
    { "prefix": "2001:db8:251::/48", "input": "2001:db8:251::/48", "version": 6, "status": "new", "reason": "NEW", "importable": true, "message": "Prefixo novo." }
  ],
  "invalid": [{ "input": "nope", "reason": "INVALID_CIDR", "message": "Não é um prefixo IPv4/IPv6 válido em notação CIDR." }],
  "duplicates": ["10.251.20.0/24"],
  "normalized": [{ "input": "10.251.20.1/24", "prefix": "10.251.20.0/24" }]
}
```

`diff` keeps the order of first appearance. Status/reason meaning (mirrors
`createSubnet`, so `importable` predicts what the import will do):

| status | reason | importable | Meaning |
|---|---|---|---|
| `new` | `NEW` | yes | No collision. |
| `new` | `NEW_OVERLAPS_OTHER_SCOPE` | yes | Overlaps subnets of another Site or VRF (allowed); see `overlaps` (`sameScope: false`). |
| `exists` | `EXISTS_SAME` | no | Same CIDR in this Site, same VRF (and same purpose/environment when sent). |
| `changed` | `EXISTS_DIFFERENT_ATTRIBUTES` | no | Same CIDR in this Site but different VRF, or different `purpose`/`environment` when those were sent. `changes[]` lists `{ field, current, proposed }`. The import never edits existing subnets. |
| `conflict` | `OVERLAP` | no | Overlaps a subnet in the same Site + VRF. `overlaps[].relation`: `within` = the pasted prefix sits inside the existing subnet, `contains` = it contains it. |
| `conflict` | `EXISTS_OUTSIDE_SITE` | no | Same CIDR exists in another Site or with no Site (CIDRs are globally unique). |

Subnets the user cannot read are returned as `{ "id": null, "cidr": null, "hidden": true }`.

### 2. RIPEstat lookup (unchanged)

`{ "query": "AS3333", "queryType": "asn" }` still returns exactly
`{ id, query, queryType, prefixes, status }`. Optionally add `siteId` (and
`vrfId`, `purpose`, `environment`) to get the same diff response as a paste,
with `"source": "RIPESTAT"`.

### 3. Confirm — `POST /api/v1/ipam/ripe/import` (unchanged)

```json
{ "importId": "6f1d…", "prefixes": ["10.251.20.0/24", "2001:db8:251::/48"], "siteId": "2000…0001", "vrfId": null, "purpose": "Public", "environment": "prod" }
```

- `prefixes` must use the **normalised** `diff[].prefix` values (others are ignored).
- For diff previews, `siteId` and `vrfId` must equal the preview's `target`,
  otherwise `400 RIPE_PREVIEW_TARGET_MISMATCH` (the diff would be stale).
  Previews without a Site (plain RIPEstat) are not affected.
- Response unchanged: `{ status: "IMPORTED"|"PARTIAL"|"FAILED", created: Subnet[], skipped: [{ cidr, reason }] }`.
- `GET /api/v1/ipam/ripe/imports/:id` returns the stored preview, with
  `result.{ prefixes, source, target, diff, summary, invalid, duplicates, normalized }`.

## NAT rules: Site permission on every write

`POST /nat-rules`, `PATCH /nat-rules/:id` and `DELETE /nat-rules/:id` now
resolve every Site the rule touches — its `siteId`, its VRF's Site, the
source/translated subnets' Sites, the source/translated IPs' subnet Sites and
the device's Site — and require the action (`CREATE`/`UPDATE`/`DELETE`) on
**all** of them. Before, only rules with a `sourceSubnetId` were checked on
update/delete, so VRF-only or Site-only rules could be edited or deleted by any
user who could read them.

- `PATCH` checks the rule as it is now **and** as it will be after the change,
  so a rule cannot be moved into a Site the user cannot write.
- Readable Site but missing the action → `403 IPAM_SCOPE_FORBIDDEN`.
  Site the user cannot see at all → `404 IPAM_RESOURCE_NOT_FOUND` (same as the rest of IPAM).
- A rule with no Site link at all can only be written by `ADMIN`; others get
  `403 IPAM_NAT_SITE_REQUIRED`. (Non-admins could never list such rules anyway.)
- A referenced id that does not exist → `404 IPAM_NAT_REFERENCE_NOT_FOUND`.
