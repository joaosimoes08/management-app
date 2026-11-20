# SNMP trap catalog (Cisco Catalyst 9300)

`trap-catalog.ts` maps 51 notification OIDs (5 standard SNMPv2/IF-MIB, 46 Cisco) to `{ mib, name, category, severity, label, clearScope }`,
decodes the key varbinds into a readable summary, and gives problem/recovery pairs a shared
clear key. The SNMP worker stores the decoded category and severity on `SnmpTrapEvent`; the
API operations reconciler turns WARNING+ traps into operational alerts and leaves out problems
that a later recovery from the same device has cleared, so the existing reconciliation resolves
them. No schema change; raw varbinds are always kept unchanged. Notifications not in the catalog
are stored raw as `VENDOR` / `INFO` and never alert.

## Compatibility target (documentation only)

- Baseline: Catalyst **C9300-48T** (sysObjectID `1.3.6.1.4.1.9.1.2439`; stack `1.3.6.1.4.1.9.1.2494`)
  on **IOS XE 17.15.x**.
- **Not validated on hardware.** OIDs, varbind objects, table indexes and enumerations were derived
  from the official MIB sources in [cisco/cisco-mibs](https://github.com/cisco/cisco-mibs/tree/main/v2)
  (CISCO-ENVMON-MIB, CISCO-ENTITY-SENSOR-MIB, CISCO-ENTITY-FRU-CONTROL-MIB, CISCO-STACKWISE-MIB,
  CISCO-PROCESS-MIB, CISCO-ENHANCED-MEMPOOL-MIB, CISCO-ERR-DISABLE-MIB, CISCO-CONFIG-MAN-MIB) and
  IETF SNMPv2-MIB / IF-MIB, and resolved with net-snmp `snmptranslate -On`.
- The test fixtures in `fixtures/cisco-c9300-traps.synthetic.json` are **synthetic**: hand-built from
  the MIB `OBJECTS`/`INDEX`/`SYNTAX` clauses, not captured from a switch. Real devices may add extra
  varbinds (for example Cisco appends `ifDescr`/`ifType` to linkDown) or omit some.
- Cisco's recommended IOS XE release changes over time; re-check the target release before relying
  on this list.

## Expected device configuration (unverified)

These are the `snmp-server enable traps` keywords expected to produce the catalogued notifications.
They are listed from Cisco documentation conventions and have **not** been tested on a device:

```
snmp-server enable traps snmp linkdown linkup coldstart warmstart authentication
snmp-server enable traps envmon
snmp-server enable traps entity-sensor
snmp-server enable traps fru-ctrl
snmp-server enable traps stackwise
snmp-server enable traps cpu threshold
snmp-server enable traps errdisable
snmp-server enable traps config
```

SNMP SET stays disabled; trap reception needs only TRAP-purpose credentials, never write credentials.

## Severity and clear pairs

| Notification | Severity | Resolved by (same device + key) |
| --- | --- | --- |
| ciscoEnvMonShutdownNotification | CRITICAL | — |
| EnvMon fan / supply / temperature / voltage (notification and status change) | HIGH, INFO when the state varbind is `normal(1)` | a status change with state `normal` for the same EnvMon index |
| entSensorThresholdNotification | HIGH | — (no recovery notification in the MIB; ages out after 24 h) |
| cefcModuleStatusChange | HIGH, INFO when `ok(2)` | module status `ok` for the same entPhysicalIndex (scope `fruModule`) |
| cefcPowerStatusChange | HIGH, INFO when `on(2)` | power status `on` for the same entPhysicalIndex (scope `fruPower`) |
| cefcFRURemoved | HIGH | cefcFRUInserted for the same entPhysicalIndex (scope `fruPresence`) |
| cefcFanTrayStatusChange | HIGH, INFO when `up(2)` | fan tray `up` for the same entPhysicalIndex (scope `fruFanTray`) |
| cefcUnrecognizedFRU | WARNING | — |
| cswStackMemberRemoved | HIGH | cswStackNewMember for the same switch number |
| cswStackPortChange | WARNING, INFO when `up(1)` | `up` for the same stack-port ifIndex |
| cswStackRingRedundant | WARNING, INFO when `true(1)` | `true` |
| cswStackNewMaster, cswStackMismatch | WARNING | — |
| cpmCPURisingThreshold | WARNING | cpmCPUFallingThreshold for the same cpmCPUTotalIndex |
| linkDown | WARNING | linkUp for the same ifIndex |
| cErrDisableInterfaceEvent / Rev1 | WARNING | linkUp for the same ifIndex |
| coldStart / authenticationFailure | WARNING / CRITICAL (unchanged) | — |
| linkUp, warmStart, FRU inserted, new member, CPU falling, config, mem buffer, PSU output mode | INFO | — |
| StackPower notifications (`.9.9.500.0.0.7`–`.22`) | INFO, never alert | — |

Clear scopes never cross condition families: a module `ok` does not clear a power or fan-tray
failure on the same entPhysicalIndex, and an insert does not clear a power-off. EnvMon fan, supply,
temperature and voltage use separate scopes (`envFan`, `envSupply`, `envTemperature`, `envVoltage`).

### Ordering and the 100-trap cap

- A recovery clears a problem only if it provably happened at or after it; when the order is ambiguous
  the problem stays open (fail-safe). Uptime is read from the stored `uptimeTicks` column, falling back
  to the `sysUpTime.0` varbind.
  - A coldStart/warmStart from the same device received between the two traps (±5 min) is a reboot
    boundary: the problem stays open.
  - With both uptimes, uptime decides (handles reordered UDP delivery) only when the smaller uptime is
    over 5 min and the uptime delta matches the receive delta within 5 min; otherwise the traps may be
    from different boots and the problem stays open.
  - Without both uptimes, `receivedAt` decides.
- The reconciler still builds candidates from the newest 100 WARNING+ traps. Independently, it loads
  every open `SNMP_TRAP` alert's trap, finds later recoveries and passes those alert keys to
  `reconcileSource(…, resolveKeys)`, so clears resolve even when more than 100 traps keep the
  stale-sweep off. Recoveries are looked up at most 30 days back; paging stops after 40 pages of 500 rows
  with a logged warning (the rest is handled on a later pass). Resolve queries are batched by 1,000 keys.

## OID notes from the MIB check

- CISCO-STACKWISE-MIB notifications live under `ciscoStackWiseMIBNotifs(…500.0)` **`.0`**, i.e.
  `1.3.6.1.4.1.9.9.500.0.0.N`, not `…500.0.N`.
- CISCO-PROCESS-MIB: `ciscoProcessMIBNotifs ::= { ciscoProcessMIBNotifPrefix 0 }` with the prefix at
  `…109.2`, so `cpmCPURisingThreshold` = `1.3.6.1.4.1.9.9.109.2.0.1` (confirmed).
- CISCO-ERR-DISABLE-MIB: the deprecated `cErrDisableInterfaceEvent` is `…548.0.1.1`; the current
  `cErrDisableInterfaceEventRev1` is `…548.0.2`. Both are catalogued.
- `cempMemBufferNotify` (`…221.0.1`) fires whenever a buffer peak is updated, not on low memory, so it
  is INFO.
