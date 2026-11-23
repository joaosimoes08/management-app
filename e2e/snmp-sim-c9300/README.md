# Simulated Cisco Catalyst C9300 (Phase 2 SNMP testing)

A lab-only SNMP agent that looks like a 2-member Catalyst C9300 stack, in two variants, so Phase 2 polling,
health and alerting work can be developed and tested without a real switch. No app code depends on it yet.

| Variant | Host port (UDP) | What it shows |
|---|---|---|
| `healthy` | `127.0.0.1:16161` | 45 days up, low CPU and memory, all PSUs and fans normal, both uplinks up, both stack members ready, ring redundant |
| `degraded` | `127.0.0.1:16162` | rebooted 4 minutes ago; member 1 CPU 97/94/91 % (5 s / 1 min / 5 min); Processor memory 94 % used; Switch 2 PSU B `notFunctioning` and Switch 1 Fan 2 `critical`; inlet temperature warning; uplink 2 (Te2/1/1) admin up / oper down and its CDP/LLDP neighbour gone; much higher error counters on both uplinks and Gi2/0/1; stack member 2 `verMismatch` (not ready); stack ring not redundant |

Set `SIM_BIND=0.0.0.0` before `up` if a container or another machine has to reach the simulator. The default only binds localhost.

## Credentials (LAB-ONLY test values)

These values are for this simulator only. Never configure them on a real device.

| | |
|---|---|
| SNMPv2c | community `lab-public` |
| SNMPv3 | user `labpoll`, authPriv, SHA auth key `lab-poll-auth-pass`, AES-128 priv key `lab-poll-priv-pass` |

SNMPv3 answers with an empty context name, which is what the app's poller sends, and also with context `lab-public`.
The entrypoint does this by serving the same data file as `<community>.snmprec` and `self/1.3.6.1.6.1.1.0.snmprec`.
That is snmpsim's lookup path for an empty context over UDP/IPv4.

## Run

```sh
docker compose -f e2e/snmp-sim-c9300/docker-compose.yml up -d --build
node e2e/snmp-sim-c9300/walk-check.mjs        # exits 1 on any failed check
docker compose -f e2e/snmp-sim-c9300/docker-compose.yml down
```

`walk-check.mjs` needs net-snmp (`snmpbulkwalk`, `snmpget`) with AES on `PATH`. It runs a bulk walk on both variants over v2c and v3 and then checks:

- the key OIDs below exist with the expected structure;
- every healthy/degraded difference listed above;
- v2c and v3 return exactly the same data;
- a wrong community and a wrong v3 auth key are refused.

`SIM_HEALTHY` and `SIM_DEGRADED` override the targets.

```sh
snmpget -v2c -c lab-public 127.0.0.1:16161 1.3.6.1.2.1.1.5.0
snmpbulkwalk -v3 -l authPriv -u labpoll -a SHA -A lab-poll-auth-pass -x AES -X lab-poll-priv-pass 127.0.0.1:16162 1.3.6.1.4.1.9.9.109
```

## What it answers

| MIB | Subtree | Contents |
|---|---|---|
| SNMPv2-MIB system | `1.3.6.1.2.1.1` | sysDescr (IOS XE 17.9.4a, CAT9K_IOSXE), sysObjectID `1.3.6.1.4.1.9.1.2494`, sysUpTime, sysName `sim-c9300-01` |
| IF-MIB ifTable | `1.3.6.1.2.1.2.2.1` | 8 ports: Gi1/0/1-3 (ifIndex 1-3), Gi2/0/1-3 (4-6), Te1/1/1 uplink 1 (49), Te2/1/1 uplink 2 (50); status, speed, octets, discards, in/out errors |
| IF-MIB ifXTable | `1.3.6.1.2.1.31.1.1.1` | ifName, ifHCIn/OutOctets, ifHighSpeed, ifAlias (`UPLINK-CORE-SW-01/02`, 6 × `ACCESS-…`) |
| ENTITY-MIB | `1.3.6.1.2.1.47.1.1.1.1` | stack (1), chassis members (1000, 2000, C9300-48P), PSU A/B (x010/x011), fans 1/2 (x020/x021) |
| CISCO-PROCESS-MIB | `1.3.6.1.4.1.9.9.109.1.1.1.1` | cpmCPUTotal 5 s / 1 min / 5 min (`…Rev` gauges) per member |
| CISCO-MEMORY-POOL-MIB | `1.3.6.1.4.1.9.9.48.1.1.1` | Processor and lsmpi_io pools: used / free |
| CISCO-ENVMON-MIB | `1.3.6.1.4.1.9.9.13.1` | 2 temperature sensors, 4 fans, 4 power supplies with state |
| CISCO-STACKWISE-MIB | `1.3.6.1.4.1.9.9.500.1` | cswRingRedundant; cswSwitchInfoTable per member: number, role, priority, state, MAC |
| CISCO-CDP-MIB | `1.3.6.1.4.1.9.9.23.1.2.1.1` | neighbours: AP on Gi1/0/1, core-sw-01 on uplink 1, core-sw-02 on uplink 2 (healthy only) |
| LLDP-MIB | `1.0.8802.1.1.2.1.3` / `.4.1.1` | local system and ports; the same neighbours as CDP |

All names, serials, MACs and addresses are synthetic.

## Changing the data

Both `data/*.snmprec` files are generated from `gen-snmprec.mjs`, so the two variants keep the same structure. Never edit the `.snmprec` files by hand. Edit the model in `gen-snmprec.mjs`, then:

1. Rewrite both files (sorted by OID, as snmpsim needs): `node e2e/snmp-sim-c9300/gen-snmprec.mjs`
2. Confirm they are current (exits non-zero if a committed file is stale): `node e2e/snmp-sim-c9300/gen-snmprec.mjs --check`
3. Re-run the checks below (`walk-check.mjs` and `poll-check.sh`) with the simulator rebuilt: `docker compose -f e2e/snmp-sim-c9300/docker-compose.yml up -d --build`

## Health polling check (Phase 2 step 8)

`poll-check.sh` starts the simulator, runs `apps/snmp/src/device-health.sim.spec.ts` against it, and always stops it again:

```sh
./e2e/snmp-sim-c9300/poll-check.sh
```

The spec polls the healthy (udp 16161) and degraded (udp 16162) stack over SNMPv2c and SNMPv3 authPriv with the app's own session and parsers, and checks that the healthy -> degraded sequence is recorded as a reboot (sysUpTime drop). It is skipped in the normal unit run unless `SNMP_SIM_C9300=1`.

`walk-check.mjs` now fails (instead of passing the refusal checks) when the simulator is not answering valid credentials.

The image pins snmpsim 1.1.7 and pysnmp 6.2.6, the same as `e2e/snmp-trap-lab/snmpsim`. Newer versions fail SNMPv3 privacy against net-snmp clients.
