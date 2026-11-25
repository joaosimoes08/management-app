# SNMP trap lab

End-to-end proof of the trap path (PLAN.md Phase 1 step 6, acceptance steps 1–4 of §0):
net-snmp packet → trap receiver → `SnmpTrapEvent` → API reconciler → `OperationalAlert` → `GET /api/v1/operations/alerts`.

```bash
pnpm test:snmp-lab            # build, start, run every case, tear down (docker compose -p snmplab down -v)
SNMPLAB_KEEP=1 pnpm test:snmp-lab   # leave the lab running to inspect it; then: docker compose -p snmplab down -v
```

Needs Docker with Compose v2 and Node 22 (only to generate the throwaway keyring). CI: `.github/workflows/snmp-trap-lab.yml` (ubuntu-latest).

## Isolation
- Compose project `snmplab`, its own bridge network `10.250.62.0/24`, its own volume. **No host ports are published**, so it never collides with a running Management-App (`:3000`, `:5432`, UDP 162…).
- Images are built from this checkout (`snmplab-api:local`, `snmplab-snmp:local`, `snmplab-sender:local`, `snmplab-snmpsim:local`).
- The SNMP keyring is generated per run in `.lab/` (git- and docker-ignored). Logs: `.lab/logs/`.

## Lab
| Service | IP | Role |
|---|---|---|
| postgres, redis | .5, .6 | throwaway data stores (migrations run by the API on start) |
| oidc | .7 | lab-only token issuer (JWKS + ADMIN token); the API runs with real JWT auth |
| api | .8 | Management-App API (reconciler every 10 s) |
| snmp | .10 | receiver + worker, production default policy (SNMPv3 and SNMPv2c accepted, SNMPv1 refused) |
| snmp-v3only | .11 | second receiver with the admin opt-out `SNMP_ALLOW_V2C=false` |
| sender | .20 (+ .21–.24, .100–.189) | net-snmp `snmptrap`/`snmpinform` and the test runner (`run.mjs`) |
| snmpsim | .30 | simulated core switch `core-sw-01`, SNMPv3 authPriv |

Seed: site `SNMPLAB`; `sw-access-01` (.20, v3 SHA/AES-128), `sw-access-02` (.22, v3 SHA-256/AES-128), `sw-access-03` (.23, v2c), and `core-sw-01`. Documented uplinks: sw-access-01 Gi1/0/48 and Gi1/0/46, sw-access-02 Gi1/0/48, sw-access-03 Gi1/0/48 → core-sw-01; sw-access-01 Gi1/0/1 is an access port.

## Cases
0. Sanity: the simulated core switch answers an SNMPv3 GET.
1. v3 SHA/AES-128 linkDown on an uplink → HIGH alert in the alerts API, with the device's site. 1b: a linkDown on a non-uplink port is stored, no alert.
2. linkUp on the same port → alert RESOLVED.
3. SHA-256 trap accepted → alert.
4. v3 inform acknowledged (`snmpinform` exit 0), stored once → alert.
5. Wrong v3 user → `REJECTED` (`SNMP_TRAP_UNKNOWN_USER`), no device alert.
6. Unregistered source → `UNMATCHED` + `SNMP_TRAP_SOURCE` alert.
7. v2c → `REJECTED` (`SNMP_V2C_DISABLED`) and no alert on the receiver with `SNMP_ALLOW_V2C=false`; accepted (`PROCESSED`) and alerted on the default receiver.
9. Trap and alert aged 25 h in the DB (simulated clock) → the alert stays open after later reconcile passes.
8. 90 traps from 90 rotating sources with `SNMP_TRAP_UNTRUSTED_ROWS_PER_MINUTE=30` → rows written stay within the budget, the rest is counted in `snmp_trap_untrusted_rows_dropped_total`.

## What it does not prove
- Host UDP 162 → container on a real network, and source-IP preservation through Docker Desktop on macOS: the sender is a container on the same Linux bridge.
- Cisco C9300 interop (real OIDs, AES-256 key extension, informs with the switch's engine ID): Phase 3, on the hardware.
- The dashboard UI itself (the lab checks the alerts API the dashboard reads).
