# Rack PDUs, outlets and wattage estimates — API contract

Back end for the rack PDU feature (proposal §2–§4). All watt values are **estimates**. Writes need ADMIN or SYSTEMS_OPERATOR (same as rack edits); reads follow the normal rack/device visibility. Every write is audited.

Defaults (outlets 32, budget 3680 W, plug count 2, watts by device type, 80 % / 100 % thresholds) live in one file: `apps/api/src/infrastructure/power/power-defaults.ts`. Changing them only affects PDUs/devices that fall back to them; existing PDUs keep their stored outlet count and budget.

Errors use the app's usual shape: `{ code, message, details? }`.

## Read: `GET /api/v1/racks/:id` (and `GET /api/v1/racks`, `GET /api/v1/sites/:siteId/racks`)

The rack payload gains:

```ts
powerMode: 'SUPPLIER_ONLY' | 'SUPPLIER_AND_UPS'      // derived: a UPS PDU exists
pdus: PduSummary[]                                   // SUPPLIER first, then UPS
power: { mode, totals: { estimatedWatts: number; bySource: { SUPPLIER: number; UPS: number }; unconnectedDeviceIds: string[] } }
devices: (Device & { power: DevicePowerSummary | null })[]

type LoadLevel = 'ok' | 'warning' | 'critical'        // warning ≥80 %; critical = all outlets used / >100 % of budget
type PowerValueSource = 'manual' | 'modelo' | 'padrão'

interface PduSummary {
  id: string; rackId: string; source: 'SUPPLIER' | 'UPS'; name: string | null
  outletCount: number; budgetWatts: number | null     // null = no budget, never warns
  usedOutlets: number; freeOutlets: number
  estimatedWatts: number                              // normal operation, sum of shares, 1 W precision
  failoverWatts: number                               // if the other feed fails: full load of every device with a plug here
  levels: { outlets: LoadLevel; watts: LoadLevel; failoverWatts: LoadLevel }
  connections: {
    deviceId: string; deviceName: string; deviceType: string
    outlets: { outletIndex: number; plugIndex: number }[]   // this PDU only
    deviceEstimatedWatts: number; wattsSource: PowerValueSource
    estimatedWattsShare: number                        // watts × plugs here / connected plugs
  }[]
}

interface DevicePowerSummary {
  deviceId: string
  plugCount: number; plugCountSource: PowerValueSource
  estimatedWatts: number; wattsSource: PowerValueSource
  connectedPlugs: number
  redundant: boolean                                   // plugs reach both SUPPLIER and UPS
  assignments: { plugIndex: number; pduId: string; source: 'SUPPLIER' | 'UPS'; outletIndex: number }[]
}
```

Rounding to 10 W, `~`, "estimado" and kW formatting are front-end concerns.

## `GET /api/v1/power/defaults`

`{ pduOutletCount, pduBudgetWatts, maxPduOutletCount, powerPlugCount, minPowerPlugCount, maxPowerPlugCount, maxWatts, wattsByDeviceType, wattsFallback, warningRatio, criticalRatio }` — for prefilling forms.

## `POST /api/v1/racks`

Body adds optional `powerMode` (default `SUPPLIER_ONLY`), `supplierPdu?`, `upsPdu?` (`{ name?, outletCount?, budgetWatts? }`). `PATCH /api/v1/racks/:id` does **not** accept these (400): use the endpoint below.

## `PUT /api/v1/racks/:id/pdus` — power mode and PDU settings

```json
{ "mode": "SUPPLIER_AND_UPS", "supplier": { "name": "PDU A", "outletCount": 32, "budgetWatts": 3680 }, "ups": { "budgetWatts": null } }
```
Omitted fields keep current values (or defaults when the PDU is created). `name: null` / `budgetWatts: null` clear them. `outletCount` 1–96.

Response: `RackPowerSummary` = `{ mode, pdus: PduSummary[], devices: DevicePowerSummary[], totals }`.

409s:
- `PDU_HAS_CONNECTIONS` — switching to `SUPPLIER_ONLY` while the UPS PDU has devices. `details: { pduId, source, devices: [{ deviceId, deviceName, outlets: number[] }] }`. Use the DELETE below per device ("Desligar todos da UPS").
- `PDU_OUTLETS_IN_USE` — `outletCount` below an occupied outlet. Same `details` shape plus `outletCount`, listing only devices on outlets beyond the new count.

## `PUT /api/v1/devices/:id/power` — replace all of a device's plug assignments

```json
{ "powerPlugCount": 2, "estimatedWatts": 450, "plugs": [ { "plugIndex": 1, "pduId": "<supplier pdu>" }, { "plugIndex": 2, "pduId": "<ups pdu>", "outletIndex": 5 } ] }
```
- `powerPlugCount` (0–8) / `estimatedWatts`: omitted = unchanged; `null` = fall back to model, then default. (Also accepted on `POST/PATCH /devices`; `DeviceModel` accepts `powerPlugCount`, `typicalWatts`, `maxWatts`.)
- `plugs` omitted → default distribution: Só rede = every plug on the supplier PDU; Rede + UPS = plug 1 supplier, plug 2 UPS, alternating; 1 plug → supplier.
- `plugs: []` disconnects every plug. Plugs not listed, or with `pduId: null`, stay "Não ligado".
- `outletIndex` omitted/null → lowest free outlet on that PDU (outlet 1 = top).

Response:
```ts
{ deviceId, rackId, mode, device: DevicePowerSummary | null,
  unplugged: { plugIndex: number; reason: 'NOT_REQUESTED' | 'NO_FREE_OUTLET'; pduId?: string }[],
  warnings: ('NO_FREE_OUTLET' | 'PLUGS_NOT_CONNECTED' | 'NO_REDUNDANT_FEED')[],
  pdus: PduSummary[], totals }
```
Warnings never block saving.

Errors: 409 `PDU_OUTLET_TAKEN` (explicit outlet used by another device or twice in the request, or a concurrent save took it — refresh and retry), 409 `PDU_NOT_IN_RACK`, 409 `DEVICE_NOT_IN_RACK`, 400 `POWER_PLUG_OUT_OF_RANGE`, `POWER_PLUG_DUPLICATED`, `PDU_OUTLET_OUT_OF_RANGE`.

## `DELETE /api/v1/racks/:rackId/pdus/:pduId/devices/:deviceId` — "Desligar"

Frees that device's outlets on that PDU only. Response `{ removed: number, mode, pdus: PduSummary[], totals }`. 404 if the PDU is not in that rack.

## Automatic changes

- Moving a device to another rack (`PATCH /devices/:id`, `PATCH /devices/:id/placement`, bulk update) or removing it from a rack deletes all its assignments in the same transaction; offer the power step again.
- Lowering a device's plug count deletes assignments for plugs that no longer exist.
- Deleting a device, PDU or rack cascades. Retiring a device keeps its outlets (it stays in the rack).

## Migration

`20261120200000_rack_pdu_power`: additive. Every existing rack gets one SUPPLIER PDU (32 outlets, 3680 W). No device is auto-connected.
