# SNMP metric history

The SNMP worker records successful interface/system observations in `SnmpSnapshot` and `SnmpInterfaceObservation`. The related `SnmpJob` rows retain completed, failed and blocked poll attempts so the history can show availability gaps and error codes alongside readings.

The authenticated endpoint `GET /api/v1/snmp/devices/:deviceId/metrics` uses the same device access check as the SNMP overview. It accepts `days=1`, `7` or `30` and an optional positive `interfaceIndex`; a request without an index selects the first interface in the latest snapshot. Results are capped at 1,000 observations and poll outcomes per response.

Interface traffic is calculated as the counter delta between consecutive successful observations. The worker prefers IF-MIB 64-bit high-capacity counters and falls back to 32-bit octet counters, accounting for 32-bit rollover. The first reading, a reset in a 64-bit counter, a missing counter or a non-increasing timestamp has no rate. The chart places samples in time and breaks lines when the gap is more than twice the configured poll interval. The availability percentage is the share of recorded poll attempts that completed in the selected period, not a duration-weighted SLA or a ping measurement. Failed polls count as unsuccessful SNMP polls; blocked attempts have no availability measurement. Empty spaces in the timeline indicate periods with no recorded attempt.

The worker removes terminal `POLL` jobs older than `SNMP_METRICS_RETENTION_DAYS` at startup and hourly. Their snapshots and interface observations are deleted by the existing cascading relation. The default is 90 days; supported values are whole days from 1 through 3,650. The setting is read by the worker process, so change it in the SNMP worker environment and restart that worker to apply it.

The implementation has unit and simulated-data coverage only. It has not been validated against a real SNMP target. Interface counter support, device-specific counter behavior, polling cadence and actual traffic values remain unverified until tested with target hardware.
