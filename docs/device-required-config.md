# Required device configurations — API contract

Back-end for "device settings in tabs, required fields block saving, bell alert when a device lacks a new configuration".
Registry: `apps/api/src/infrastructure/required-config/device-required-config.ts` (single source of truth; the web app reads it over HTTP).
No Prisma migration: everything is computed live from existing columns (`Device.backAssetId`, `DeviceModel.backAssetId`, `powerPlugCount`, `PduOutletAssignment`).

## Registry

`GET /api/v1/devices/required-configs` (any authenticated user)

```json
{
  "tabs": [{ "key": "geral", "label": "Geral" }, { "key": "localizacao", "label": "Localização" }, { "key": "imagens", "label": "Imagens" }, { "key": "energia", "label": "Energia" }],
  "configs": [
    { "key": "name",      "kind": "CORE",    "tab": "geral",       "fields": ["name"],                    "label": "Nome", "missingMessage": "…", "appliesWhen": "Sempre." },
    { "key": "type",      "kind": "CORE",    "tab": "geral",       "fields": ["type"],                    "label": "Tipo", … },
    { "key": "placement", "kind": "CORE",    "tab": "localizacao", "fields": ["siteId", "rackId"],        "label": "Site ou bastidor", … },
    { "key": "rearImage", "kind": "FEATURE", "tab": "imagens",     "fields": ["backAssetId"],             "label": "Imagem traseira", … },
    { "key": "power",     "kind": "FEATURE", "tab": "energia",     "fields": ["power", "powerPlugCount"], "label": "Tomadas de energia", … }
  ]
}
```

When a config applies / is satisfied:

| key | applies | satisfied |
|---|---|---|
| name, type | always | non-blank |
| placement | always | `siteId` or `rackId` |
| rearImage | device in a rack and `status != RETIRED` | `backAssetId` set **or** the model has a rear image |
| power | in a rack, not RETIRED, effective plug count > 0 (device → model → default 2) | at least one plug connected to a PDU outlet |

`powerPlugCount: 0` means "sem alimentação" (patch panels, etc.) and makes `power` not apply.

Adding a future config: add a registry entry, then teach `deviceConfigStatus` and `missingConfigWhere` (a unit test checks both agree).

## New vs existing device rule

- **Create** (`POST /devices`): every config that applies must be satisfied.
- **Update** (`PATCH /devices/:id`, `PUT /devices/:id/power`): CORE configs are always enforced. For a FEATURE config that applies after the save and is not satisfied:
  - **`CLEARED`** if it was satisfied before. A save must never empty a filled config. Examples: `backAssetId: null` when the model has no rear image, switching to a model without one, `PUT power { plugs: [] }`, or moving a powered device to another rack without `power` (the move frees the old outlets).
  - **`MISSING`** if the requirement starts with this save. **Placing a device is treated like creating it there.** This covers: entering a rack from a Site (no rack), moving to another rack, leaving `RETIRED` inside a rack, or going from 0 plugs to some. Such a PATCH must bring the rear image (its own `backAssetId` or a model that has one) and `power` (or `powerPlugCount: 0`).
  - **Allowed** otherwise. A legacy device that stays in the same rack keeps its gap while unrelated fields (name, notes, IP…) are edited, and it keeps showing in the bell until fixed.
  - Leaving a rack never needs either config.
- The PATCH precheck returns every error at once. Power is then re-checked inside the transaction, and `NO_FREE_OUTLET` is only known there.
- Not enforced; affected devices show up in the bell instead: bulk update, drag placement (`PATCH /devices/:id/placement`), CSV import, SNMP onboarding/discovery, "Desligar" (`DELETE /racks/:id/pdus/:pduId/devices/:deviceId`), removing a model's rear image, deleting an asset.

### Request changes (breaking for the create flow)

`POST /devices` and `PATCH /devices/:id` accept an optional `power` object, which has the same shape as the `PUT /devices/:id/power` body (`{}` = default distribution; `{ plugs: [...] }`, `powerPlugCount`, `estimatedWatts`). It is applied in the same transaction after the device is created or moved.
A racked device with plugs **must** be created with `power` (or with `powerPlugCount: 0`). The old flow "create, then PUT power" now returns 400.

## Error shape

Any violation returns HTTP 400:

```json
{
  "code": "REQUIRED_CONFIG_MISSING",
  "message": "Faltam 2 configurações obrigatórias.",
  "details": {
    "errors": [
      { "config": "rearImage", "tab": "imagens", "fields": ["backAssetId"], "reason": "MISSING", "message": "Carrega a imagem traseira do equipamento ou escolhe um modelo que já a tenha." },
      { "config": "power", "tab": "energia", "fields": ["power", "powerPlugCount"], "reason": "MISSING", "message": "Liga pelo menos uma ficha…" }
    ]
  }
}
```

- `reason` is one of `MISSING`, `CLEARED` or `NO_FREE_OUTLET` (power was requested but no outlet was free; nothing is written).
- With a single error, `message` is that error's message.
- An empty or absent `name`/`type`, or an invalid `type`, is rejected first by DTO validation with the existing `{ code: "VALIDATION_ERROR", details: { errors: ["name must be …"] } }`. A whitespace-only name gets `REQUIRED_CONFIG_MISSING`.
- A missing placement (no `siteId` and no `rackId`) is now `400 REQUIRED_CONFIG_MISSING` (`config: "placement"`). It used to be 409.

## Per-device status

`GET /devices` (each item) and `GET /devices/:id` include:

```json
"requiredConfig": { "missing": ["rearImage", "power"], "missingTabs": ["imagens", "energia"], "complete": false }
```

`GET /devices?missingConfig=rearImage|power` filters the list to affected devices (an unknown value returns 400 `UNKNOWN_REQUIRED_CONFIG`).

## Affected devices

- `GET /api/v1/devices/missing-config/summary[?siteId=]` returns `{ items: [{ config, count, tab, label, siteId|null, device|null, href }] }`. There is one item per FEATURE config with count > 0. `siteId` is set when every affected device is in one Site; `device` is set when `count === 1`.
- `GET /api/v1/devices/missing-config?config=power[&siteId=][&page=1][&pageSize=25]` (max 100) returns `{ config, tab, items: [{ id, name, type, status, siteId, siteName, rackId, rackName, rackUnitStart, model, href }], page, pageSize, total, totalPages }`.

Cost per request: `visibleRoomIds` once, then one `GROUP BY siteId` per FEATURE config (in parallel), plus one device lookup only for a config with exactly 1 affected device. The topbar does this once per `topbar-state` call; if it fails, the error is logged (`DashboardService` warn) and the bell shows the other alerts.

Both are scoped to devices the user can see (rooms) **and** whose type the role can manage. ADMIN and SYSTEMS_OPERATOR see every type; NETWORK_OPERATOR sees SWITCH, ROUTER and FIREWALL; read-only roles see nothing.

## Bell alerts

`GET /api/v1/dashboard/topbar-state` → `alerts[]` gets one grouped alert per missing config, appended after the existing 8-alert cap:

```json
{
  "id": "device-missing-config-power",
  "severity": "WARNING",
  "title": "3 dispositivos sem tomadas de energia configuradas",
  "detail": "A carga das PDUs não inclui estes equipamentos.",
  "href": "/infraestrutura?tab=devices&missingConfig=power",
  "occurredAt": "2026-11-20T…Z",
  "persistent": true,
  "kind": "DEVICE_MISSING_CONFIG",
  "config": "power",
  "count": 3
}
```

- The id is stable per config, so a refresh never duplicates the alert. The alert is computed on every request: it disappears once no device is missing that config, and nothing is stored.
- `persistent: true` means "Limpar todos" must not hide it.
- For a single device, the title is singular ("1 dispositivo sem imagem traseira") and `detail` is prefixed with the device name.

## Deep links (href contract)

| case | href |
|---|---|
| exactly 1 device | `/infraestrutura?siteId=<siteId>&tab=devices&deviceId=<id>&settingsTab=imagens\|energia` |
| several devices | `/infraestrutura?[siteId=<siteId>&]tab=devices&missingConfig=rearImage\|power` (`siteId` only when they are all in one Site) |

`tab` is already the Infraestrutura page section, so the device settings tab uses `settingsTab`. Its values are the registry tab keys `geral`, `localizacao`, `imagens` and `energia`.
