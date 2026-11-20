/**
 * SNMP notification catalog and varbind decoder.
 *
 * Numeric OIDs, varbind objects, table indexes and enumerations come from the
 * official MIB modules in https://github.com/cisco/cisco-mibs (v2) and the IETF
 * SNMPv2-MIB / IF-MIB. Each entry was checked against the MIB source with
 * net-snmp `snmptranslate -On`; see README.trap-catalog.md. Compatibility
 * target: Catalyst C9300-48T on IOS XE 17.15.x — documentation only, NOT
 * validated against real hardware.
 *
 * Unknown notifications are never dropped: they classify as VENDOR/INFO and
 * the caller keeps the raw varbinds unchanged.
 */

export type TrapSeverity = 'CRITICAL' | 'HIGH' | 'WARNING' | 'INFO';

/** Varbind as persisted in SnmpTrapEvent.varbinds (OCTET STRING → { encoding: 'hex', value }). */
export type StoredVarbind = { oid: string; type?: number; value: unknown };

/** How a trap identifies the thing it is about, so a recovery can resolve the matching problem. */
export type TrapClearScope = 'interface' | 'cpu' | 'entity' | 'stackMember' | 'stackPort' | 'stackRing' | 'envFan' | 'envSupply' | 'envTemperature' | 'envVoltage';

export type TrapCatalogEntry = {
  oid: string;
  mib: string;
  name: string;
  category: string;
  severity: TrapSeverity;
  /** Portuguese UI label for the problem. */
  label: string;
  /** Label used when the decoded state is normal (downgraded to INFO). */
  recoveredLabel?: string;
  /** Problem/recovery correlation scope (same device + scope + index). */
  clearScope?: TrapClearScope;
  /** This notification always represents a recovery for its scope. */
  clears?: boolean;
  /** Catalogued for labelling only; never produces an operational alert. */
  noAlert?: boolean;
};

export const SNMP_TRAP_OID = '1.3.6.1.6.3.1.1.4.1.0';
export const SYS_UPTIME_OID = '1.3.6.1.2.1.1.3.0';

const ENVMON = '1.3.6.1.4.1.9.9.13.3.0';
const SENSOR = '1.3.6.1.4.1.9.9.91.2.0';
const FRU = '1.3.6.1.4.1.9.9.117.2.0';
const STACK = '1.3.6.1.4.1.9.9.500.0.0';
const PROCESS = '1.3.6.1.4.1.9.9.109.2.0';

const stackPower = (n: number, name: string): TrapCatalogEntry => ({
  oid: `${STACK}.${n}`, mib: 'CISCO-STACKWISE-MIB', name, category: 'STACK_POWER', severity: 'INFO', label: 'Evento StackPower', noAlert: true,
});

export const TRAP_CATALOG: readonly TrapCatalogEntry[] = [
  // SNMPv2-MIB / IF-MIB (unchanged categories and severities from the previous map)
  { oid: '1.3.6.1.6.3.1.1.5.1', mib: 'SNMPv2-MIB', name: 'coldStart', category: 'COLD_START', severity: 'WARNING', label: 'Arranque a frio' },
  { oid: '1.3.6.1.6.3.1.1.5.2', mib: 'SNMPv2-MIB', name: 'warmStart', category: 'WARM_START', severity: 'INFO', label: 'Reinício a quente' },
  { oid: '1.3.6.1.6.3.1.1.5.3', mib: 'IF-MIB', name: 'linkDown', category: 'LINK_DOWN', severity: 'WARNING', label: 'Interface em baixo', clearScope: 'interface' },
  { oid: '1.3.6.1.6.3.1.1.5.4', mib: 'IF-MIB', name: 'linkUp', category: 'LINK_UP', severity: 'INFO', label: 'Interface reposta', clearScope: 'interface', clears: true },
  { oid: '1.3.6.1.6.3.1.1.5.5', mib: 'SNMPv2-MIB', name: 'authenticationFailure', category: 'AUTHENTICATION_FAILURE', severity: 'CRITICAL', label: 'Falha de autenticação SNMP' },

  // CISCO-ENVMON-MIB  ciscoEnvMonMIBNotifications ::= { ciscoEnvMonMIB(9.9.13) 3 0 }
  { oid: `${ENVMON}.1`, mib: 'CISCO-ENVMON-MIB', name: 'ciscoEnvMonShutdownNotification', category: 'ENV_SHUTDOWN', severity: 'CRITICAL', label: 'Encerramento por condição ambiental' },
  { oid: `${ENVMON}.2`, mib: 'CISCO-ENVMON-MIB', name: 'ciscoEnvMonVoltageNotification', category: 'ENV_VOLTAGE', severity: 'HIGH', label: 'Tensão fora dos limites', recoveredLabel: 'Tensão normalizada', clearScope: 'envVoltage' },
  { oid: `${ENVMON}.3`, mib: 'CISCO-ENVMON-MIB', name: 'ciscoEnvMonTemperatureNotification', category: 'ENV_TEMPERATURE', severity: 'HIGH', label: 'Temperatura fora dos limites', recoveredLabel: 'Temperatura normalizada', clearScope: 'envTemperature' },
  { oid: `${ENVMON}.4`, mib: 'CISCO-ENVMON-MIB', name: 'ciscoEnvMonFanNotification', category: 'ENV_FAN', severity: 'HIGH', label: 'Falha de ventoinha', recoveredLabel: 'Ventoinha normalizada', clearScope: 'envFan' },
  { oid: `${ENVMON}.5`, mib: 'CISCO-ENVMON-MIB', name: 'ciscoEnvMonRedundantSupplyNotification', category: 'ENV_POWER_SUPPLY', severity: 'HIGH', label: 'Falha de fonte de alimentação', recoveredLabel: 'Fonte de alimentação normalizada', clearScope: 'envSupply' },
  { oid: `${ENVMON}.6`, mib: 'CISCO-ENVMON-MIB', name: 'ciscoEnvMonVoltStatusChangeNotif', category: 'ENV_VOLTAGE', severity: 'HIGH', label: 'Tensão fora dos limites', recoveredLabel: 'Tensão normalizada', clearScope: 'envVoltage' },
  { oid: `${ENVMON}.7`, mib: 'CISCO-ENVMON-MIB', name: 'ciscoEnvMonTempStatusChangeNotif', category: 'ENV_TEMPERATURE', severity: 'HIGH', label: 'Temperatura fora dos limites', recoveredLabel: 'Temperatura normalizada', clearScope: 'envTemperature' },
  { oid: `${ENVMON}.8`, mib: 'CISCO-ENVMON-MIB', name: 'ciscoEnvMonFanStatusChangeNotif', category: 'ENV_FAN', severity: 'HIGH', label: 'Falha de ventoinha', recoveredLabel: 'Ventoinha normalizada', clearScope: 'envFan' },
  { oid: `${ENVMON}.9`, mib: 'CISCO-ENVMON-MIB', name: 'ciscoEnvMonSuppStatusChangeNotif', category: 'ENV_POWER_SUPPLY', severity: 'HIGH', label: 'Falha de fonte de alimentação', recoveredLabel: 'Fonte de alimentação normalizada', clearScope: 'envSupply' },

  // CISCO-ENTITY-SENSOR-MIB  entitySensorMIBNotifications ::= { 9.9.91 2 0 }
  { oid: `${SENSOR}.1`, mib: 'CISCO-ENTITY-SENSOR-MIB', name: 'entSensorThresholdNotification', category: 'SENSOR_THRESHOLD', severity: 'HIGH', label: 'Limiar de sensor ultrapassado' },

  // CISCO-ENTITY-FRU-CONTROL-MIB  cefcMIBNotifications ::= { 9.9.117 2 0 }
  { oid: `${FRU}.1`, mib: 'CISCO-ENTITY-FRU-CONTROL-MIB', name: 'cefcModuleStatusChange', category: 'FRU_MODULE', severity: 'HIGH', label: 'Falha de módulo', recoveredLabel: 'Módulo operacional', clearScope: 'entity' },
  { oid: `${FRU}.2`, mib: 'CISCO-ENTITY-FRU-CONTROL-MIB', name: 'cefcPowerStatusChange', category: 'FRU_POWER', severity: 'HIGH', label: 'Falha de alimentação do componente', recoveredLabel: 'Alimentação do componente reposta', clearScope: 'entity' },
  { oid: `${FRU}.3`, mib: 'CISCO-ENTITY-FRU-CONTROL-MIB', name: 'cefcFRUInserted', category: 'FRU_INSERTED', severity: 'INFO', label: 'Componente inserido', clearScope: 'entity', clears: true },
  { oid: `${FRU}.4`, mib: 'CISCO-ENTITY-FRU-CONTROL-MIB', name: 'cefcFRURemoved', category: 'FRU_REMOVED', severity: 'HIGH', label: 'Componente removido', clearScope: 'entity' },
  { oid: `${FRU}.5`, mib: 'CISCO-ENTITY-FRU-CONTROL-MIB', name: 'cefcUnrecognizedFRU', category: 'FRU_UNRECOGNIZED', severity: 'WARNING', label: 'Componente não reconhecido' },
  { oid: `${FRU}.6`, mib: 'CISCO-ENTITY-FRU-CONTROL-MIB', name: 'cefcFanTrayStatusChange', category: 'FRU_FAN_TRAY', severity: 'HIGH', label: 'Falha de ventoinha', recoveredLabel: 'Ventoinha operacional', clearScope: 'entity' },
  { oid: `${FRU}.7`, mib: 'CISCO-ENTITY-FRU-CONTROL-MIB', name: 'cefcPowerSupplyOutputChange', category: 'FRU_PSU_OUTPUT', severity: 'INFO', label: 'Modo de saída da fonte alterado' },

  // CISCO-STACKWISE-MIB  cswMIBNotifications ::= { ciscoStackWiseMIBNotifs(9.9.500.0) 0 }
  { oid: `${STACK}.1`, mib: 'CISCO-STACKWISE-MIB', name: 'cswStackPortChange', category: 'STACK_PORT', severity: 'WARNING', label: 'Porta de stack em baixo', recoveredLabel: 'Porta de stack ativa', clearScope: 'stackPort' },
  { oid: `${STACK}.2`, mib: 'CISCO-STACKWISE-MIB', name: 'cswStackNewMaster', category: 'STACK_NEW_MASTER', severity: 'WARNING', label: 'Novo master do stack' },
  { oid: `${STACK}.3`, mib: 'CISCO-STACKWISE-MIB', name: 'cswStackMismatch', category: 'STACK_MISMATCH', severity: 'WARNING', label: 'Membro do stack recusado por incompatibilidade' },
  { oid: `${STACK}.4`, mib: 'CISCO-STACKWISE-MIB', name: 'cswStackRingRedundant', category: 'STACK_RING', severity: 'WARNING', label: 'Anel do stack sem redundância', recoveredLabel: 'Redundância do anel do stack reposta', clearScope: 'stackRing' },
  { oid: `${STACK}.5`, mib: 'CISCO-STACKWISE-MIB', name: 'cswStackNewMember', category: 'STACK_NEW_MEMBER', severity: 'INFO', label: 'Novo membro no stack', clearScope: 'stackMember', clears: true },
  { oid: `${STACK}.6`, mib: 'CISCO-STACKWISE-MIB', name: 'cswStackMemberRemoved', category: 'STACK_MEMBER_REMOVED', severity: 'HIGH', label: 'Membro removido do stack', clearScope: 'stackMember' },
  stackPower(7, 'cswStackPowerPortLinkStatusChanged'),
  stackPower(8, 'cswStackPowerPortOperStatusChanged'),
  stackPower(9, 'cswStackPowerVersionMismatch'),
  stackPower(10, 'cswStackPowerInvalidTopology'),
  stackPower(11, 'cscwStackPowerBudgetWarrning'),
  stackPower(12, 'cswStackPowerInvalidInputCurrent'),
  stackPower(13, 'cswStackPowerInvalidOutputCurrent'),
  stackPower(14, 'cswStackPowerUnderBudget'),
  stackPower(15, 'cswStackPowerUnbalancedPowerSupplies'),
  stackPower(16, 'cswStackPowerInsufficientPower'),
  stackPower(17, 'cswStackPowerPriorityConflict'),
  stackPower(18, 'cswStackPowerUnderVoltage'),
  stackPower(19, 'cswStackPowerGLS'),
  stackPower(20, 'cswStackPowerILS'),
  stackPower(21, 'cswStackPowerSRLS'),
  stackPower(22, 'cswStackPowerSSLS'),

  // CISCO-PROCESS-MIB  ciscoProcessMIBNotifs ::= { ciscoProcessMIBNotifPrefix(9.9.109.2) 0 }
  { oid: `${PROCESS}.1`, mib: 'CISCO-PROCESS-MIB', name: 'cpmCPURisingThreshold', category: 'CPU_THRESHOLD_RISING', severity: 'WARNING', label: 'Utilização de CPU acima do limiar', clearScope: 'cpu' },
  { oid: `${PROCESS}.2`, mib: 'CISCO-PROCESS-MIB', name: 'cpmCPUFallingThreshold', category: 'CPU_THRESHOLD_FALLING', severity: 'INFO', label: 'Utilização de CPU normalizada', clearScope: 'cpu', clears: true },

  // CISCO-ENHANCED-MEMPOOL-MIB  cempMIBNotifications ::= { 9.9.221 0 } — sent whenever a buffer peak is updated
  { oid: '1.3.6.1.4.1.9.9.221.0.1', mib: 'CISCO-ENHANCED-MEMPOOL-MIB', name: 'cempMemBufferNotify', category: 'MEMORY_BUFFER', severity: 'INFO', label: 'Novo pico de buffers de memória' },

  // CISCO-ERR-DISABLE-MIB  deprecated event under { 9.9.548 0 1 }, Rev1 under { 9.9.548 0 }
  { oid: '1.3.6.1.4.1.9.9.548.0.1.1', mib: 'CISCO-ERR-DISABLE-MIB', name: 'cErrDisableInterfaceEvent', category: 'ERR_DISABLE', severity: 'WARNING', label: 'Interface em err-disable', clearScope: 'interface' },
  { oid: '1.3.6.1.4.1.9.9.548.0.2', mib: 'CISCO-ERR-DISABLE-MIB', name: 'cErrDisableInterfaceEventRev1', category: 'ERR_DISABLE', severity: 'WARNING', label: 'Interface em err-disable', clearScope: 'interface' },

  // CISCO-CONFIG-MAN-MIB  ciscoConfigManMIBNotifications ::= { 9.9.43 2 0 }
  { oid: '1.3.6.1.4.1.9.9.43.2.0.1', mib: 'CISCO-CONFIG-MAN-MIB', name: 'ciscoConfigManEvent', category: 'CONFIG_EVENT', severity: 'INFO', label: 'Evento de gestão de configuração' },
  { oid: '1.3.6.1.4.1.9.9.43.2.0.2', mib: 'CISCO-CONFIG-MAN-MIB', name: 'ccmCLIRunningConfigChanged', category: 'CONFIG_CHANGE', severity: 'INFO', label: 'Configuração em execução alterada' },
];

const BY_OID = new Map(TRAP_CATALOG.map((entry) => [entry.oid, entry]));

export const VENDOR_TRAP = { category: 'VENDOR', severity: 'INFO' as TrapSeverity };

export function lookupTrap(oid?: string | null): TrapCatalogEntry | undefined {
  return oid ? BY_OID.get(normalizeOid(oid)) : undefined;
}

/** Base classification by notification OID only (no varbind decoding). */
export function classifyTrap(oid?: string | null): { category: string; severity: string } {
  const entry = lookupTrap(oid);
  return entry ? { category: entry.category, severity: entry.severity } : { ...VENDOR_TRAP };
}

// ---------------------------------------------------------------------------
// Varbind objects (column OIDs; the instance suffix is the table index)

const O = {
  ifIndex: '1.3.6.1.2.1.2.2.1.1',
  ifDescr: '1.3.6.1.2.1.2.2.1.2',
  ifAdminStatus: '1.3.6.1.2.1.2.2.1.7',
  ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
  ifName: '1.3.6.1.2.1.31.1.1.1.1',
  entPhysicalContainedIn: '1.3.6.1.2.1.47.1.1.1.1.4',
  entPhysicalName: '1.3.6.1.2.1.47.1.1.1.1.7',
  entPhysicalModelName: '1.3.6.1.2.1.47.1.1.1.1.13',
  voltDescr: '1.3.6.1.4.1.9.9.13.1.2.1.2',
  voltValue: '1.3.6.1.4.1.9.9.13.1.2.1.3',
  voltState: '1.3.6.1.4.1.9.9.13.1.2.1.7',
  tempDescr: '1.3.6.1.4.1.9.9.13.1.3.1.2',
  tempValue: '1.3.6.1.4.1.9.9.13.1.3.1.3',
  tempState: '1.3.6.1.4.1.9.9.13.1.3.1.6',
  fanDescr: '1.3.6.1.4.1.9.9.13.1.4.1.2',
  fanState: '1.3.6.1.4.1.9.9.13.1.4.1.3',
  supplyDescr: '1.3.6.1.4.1.9.9.13.1.5.1.2',
  supplyState: '1.3.6.1.4.1.9.9.13.1.5.1.3',
  entSensorValue: '1.3.6.1.4.1.9.9.91.1.1.1.1.4',
  entSensorThresholdValue: '1.3.6.1.4.1.9.9.91.1.2.1.1.4',
  cefcModuleOperStatus: '1.3.6.1.4.1.9.9.117.1.2.1.1.2',
  cefcFRUPowerAdminStatus: '1.3.6.1.4.1.9.9.117.1.1.2.1.1',
  cefcFRUPowerOperStatus: '1.3.6.1.4.1.9.9.117.1.1.2.1.2',
  cefcFanTrayOperStatus: '1.3.6.1.4.1.9.9.117.1.4.1.1.1',
  cefcPhysicalStatus: '1.3.6.1.4.1.9.9.117.1.5.1.1.1',
  cswSwitchNumCurrent: '1.3.6.1.4.1.9.9.500.1.2.1.1.1',
  cswSwitchRole: '1.3.6.1.4.1.9.9.500.1.2.1.1.3',
  cswSwitchState: '1.3.6.1.4.1.9.9.500.1.2.1.1.6',
  cswStackPortOperStatus: '1.3.6.1.4.1.9.9.500.1.2.2.1.1',
  cswRingRedundant: '1.3.6.1.4.1.9.9.500.1.1.3',
  cpmCPURisingThresholdValue: '1.3.6.1.4.1.9.9.109.1.2.4.1.2',
  cpmCPUFallingThresholdValue: '1.3.6.1.4.1.9.9.109.1.2.4.1.4',
  cpmCPUTotalMonIntervalValue: '1.3.6.1.4.1.9.9.109.1.1.1.1.10',
  cempMemBufferName: '1.3.6.1.4.1.9.9.221.1.1.2.1.3',
  cempMemBufferPeak: '1.3.6.1.4.1.9.9.221.1.1.2.1.17',
  cErrDisableIfStatusCause: '1.3.6.1.4.1.9.9.548.1.3.1.1.2',
  ccmHistoryEventTerminalType: '1.3.6.1.4.1.9.9.43.1.1.6.1.6',
  ccmHistoryEventTerminalUser: '1.3.6.1.4.1.9.9.43.1.1.6.1.8',
  ccmHistoryEventCommandSource: '1.3.6.1.4.1.9.9.43.1.1.6.1.3',
  ccmHistoryEventConfigSource: '1.3.6.1.4.1.9.9.43.1.1.6.1.4',
  ccmHistoryEventConfigDestination: '1.3.6.1.4.1.9.9.43.1.1.6.1.5',
} as const;

// Enumerations copied from the MIB SYNTAX clauses.
const CISCO_ENV_MON_STATE: Record<number, string> = { 1: 'normal', 2: 'warning', 3: 'critical', 4: 'shutdown', 5: 'notPresent', 6: 'notFunctioning' };
const IF_STATUS: Record<number, string> = { 1: 'up', 2: 'down', 3: 'testing', 4: 'unknown', 5: 'dormant', 6: 'notPresent', 7: 'lowerLayerDown' };
const CEFC_MODULE_OPER: Record<number, string> = { 1: 'unknown', 2: 'ok', 3: 'disabled', 4: 'okButDiagFailed', 5: 'boot', 6: 'selfTest', 7: 'failed', 8: 'missing', 9: 'mismatchWithParent', 10: 'mismatchConfig', 11: 'diagFailed', 12: 'dormant', 13: 'outOfServiceAdmin', 14: 'outOfServiceEnvTemp', 15: 'poweredDown', 16: 'poweredUp', 17: 'powerDenied', 18: 'powerCycled', 19: 'okButPowerOverWarning', 20: 'okButPowerOverCritical', 21: 'syncInProgress', 22: 'upgrading', 23: 'okButAuthFailed', 24: 'mdr', 25: 'fwMismatchFound', 26: 'fwDownloadSuccess', 27: 'fwDownloadFailure' };
const CEFC_POWER_OPER: Record<number, string> = { 1: 'offEnvOther', 2: 'on', 3: 'offAdmin', 4: 'offDenied', 5: 'offEnvPower', 6: 'offEnvTemp', 7: 'offEnvFan', 8: 'failed', 9: 'onButFanFail', 10: 'offCooling', 11: 'offConnectorRating', 12: 'onButInlinePowerFail' };
const CEFC_POWER_ADMIN: Record<number, string> = { 1: 'on', 2: 'off', 3: 'inlineAuto', 4: 'inlineOn', 5: 'powerCycle' };
const CEFC_FAN_TRAY_OPER: Record<number, string> = { 1: 'unknown', 2: 'up', 3: 'down', 4: 'warning' };
const CEFC_PHYSICAL_STATUS: Record<number, string> = { 1: 'other', 2: 'supported', 3: 'unsupported', 4: 'incompatible' };
const CSW_SWITCH_STATE: Record<number, string> = { 1: 'waiting', 2: 'progressing', 3: 'added', 4: 'ready', 5: 'sdmMismatch', 6: 'verMismatch', 7: 'featureMismatch', 8: 'newMasterInit', 9: 'provisioned', 10: 'invalid', 11: 'removed' };
const CSW_SWITCH_ROLE: Record<number, string> = { 1: 'master', 2: 'member', 3: 'notMember', 4: 'standby' };
const CSW_STACK_PORT_OPER: Record<number, string> = { 1: 'up', 2: 'down', 3: 'forcedDown' };
const TRUTH_VALUE: Record<number, string> = { 1: 'true', 2: 'false' };
const ERR_DISABLE_CAUSE: Record<number, string> = { 1: 'udld', 2: 'bpduGuard', 3: 'channelMisconfig', 4: 'pagpFlap', 5: 'dtpFlap', 6: 'linkFlap', 7: 'l2ptGuard', 8: 'dot1xSecurityViolation', 9: 'portSecurityViolation', 10: 'gbicInvalid', 11: 'dhcpRateLimit', 12: 'unicastFlood', 13: 'vmps', 14: 'stormControl', 15: 'inlinePower', 16: 'arpInspection', 17: 'portLoopback', 18: 'packetBuffer', 19: 'macLimit', 20: 'linkMonitorFailure', 21: 'oamRemoteFailure', 22: 'dot1adIncompEtype', 23: 'dot1adIncompTunnel', 24: 'sfpConfigMismatch', 25: 'communityLimit', 26: 'invalidPolicy', 27: 'lsGroup', 28: 'ekey', 29: 'portModeFailure', 30: 'pppoeIaRateLimit', 31: 'oamRemoteCriticalEvent', 32: 'oamRemoteDyingGasp', 33: 'oamRemoteLinkFault', 34: 'mvrp', 35: 'tranceiverIncomp', 36: 'other', 37: 'portReinitLimitReached', 38: 'adminRxBBCreditPerfBufIncomp', 39: 'ficonNotEnabled', 40: 'adminModeIncomp', 41: 'adminSpeedIncomp', 42: 'adminRxBBCreditIncomp', 43: 'adminRxBufSizeIncomp', 44: 'eppFailure', 45: 'osmEPortUp', 46: 'osmNonEPortUp', 47: 'udldUniDir', 48: 'udldTxRxLoop', 49: 'udldNeighbourMismatch', 50: 'udldEmptyEcho', 51: 'udldAggrasiveModeLinkFailed', 52: 'excessivePortInterrupts', 53: 'channelErrDisabled', 54: 'hwProgFailed', 55: 'internalHandshakeFailed', 56: 'stpInconsistencyOnVpcPeerLink', 57: 'stpPortStateFailure', 58: 'ipConflict', 59: 'multipleMSapIdsRcvd', 60: 'oneHundredPdusWithoutAck', 61: 'ipQosCompatCheckFailure', 62: 'loopDetect' };
const CCM_TERMINAL_TYPE: Record<number, string> = { 1: 'notApplicable', 2: 'unknown', 3: 'console', 4: 'terminal', 5: 'virtual', 6: 'auxiliary' };
const CCM_COMMAND_SOURCE: Record<number, string> = { 1: 'commandLine', 2: 'snmp' };
const CCM_CONFIG_LOCATION: Record<number, string> = { 1: 'erase', 2: 'commandSource', 3: 'running', 4: 'startup', 5: 'local', 6: 'networkTftp', 7: 'networkRcp', 8: 'networkFtp', 9: 'networkScp' };

// ---------------------------------------------------------------------------

export type DecodedTrap = {
  known: boolean;
  oid?: string;
  mib?: string;
  name?: string;
  category: string;
  severity: TrapSeverity;
  /** Portuguese label (recoveredLabel when the decoded state is normal). */
  label: string;
  /** What the trap is about, e.g. "Switch 1 - FAN 1", "Gi1/0/5", "Switch 2". */
  subject?: string;
  /** Short readable summary of the decoded varbinds. */
  summary: string;
  /** Decoded fields (enum names resolved). */
  fields: Record<string, string | number>;
  /** Correlation key `<scope>:<index>`; problems and recoveries share it. */
  clearKey?: string;
  /** True when this trap represents a recovery for clearKey. */
  isClear: boolean;
  /** Whether a WARNING+ instance of this trap may raise an operational alert. */
  alertable: boolean;
};

function normalizeOid(oid: string) { return oid.replace(/^\./, ''); }

type Hit = { value: unknown; index: string };

function find(varbinds: readonly StoredVarbind[], column: string): Hit | undefined {
  const prefix = `${column}.`;
  for (const item of varbinds) {
    const oid = normalizeOid(String(item?.oid ?? ''));
    if (oid === column) return { value: item.value, index: '' };
    if (oid.startsWith(prefix)) return { value: item.value, index: oid.slice(prefix.length) };
  }
  return undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value);
  return undefined;
}

/** OCTET STRING values are persisted as { encoding: 'hex', value }. Return printable text or undefined. */
function text(value: unknown): string | undefined {
  let decoded: string | undefined;
  if (typeof value === 'string') decoded = value;
  else if (value && typeof value === 'object' && (value as any).encoding === 'hex' && typeof (value as any).value === 'string') {
    const hex = (value as any).value as string;
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) return undefined;
    decoded = Buffer.from(hex, 'hex').toString('utf8');
  }
  if (decoded === undefined) return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = decoded.replace(/\u0000+$/g, '').trim();
  // eslint-disable-next-line no-control-regex
  if (!cleaned || /[\u0000-\u0008\u000e-\u001f�]/.test(cleaned)) return undefined;
  return cleaned.slice(0, 128);
}

function enumName(map: Record<number, string>, value: unknown) {
  const n = num(value);
  if (n === undefined) return undefined;
  return map[n] ?? `valor ${n}`;
}

function firstIndex(index: string) { return index.split('.')[0] || undefined; }

/**
 * Decode a notification. Never throws; unknown OIDs return VENDOR/INFO.
 * Raw varbinds are not modified.
 */
export function decodeTrap(trapOid: string | null | undefined, varbinds: unknown): DecodedTrap {
  const list: StoredVarbind[] = Array.isArray(varbinds) ? (varbinds as StoredVarbind[]).filter((item) => item && typeof item === 'object') : [];
  const entry = lookupTrap(trapOid);
  if (!entry) {
    return { known: false, oid: trapOid ?? undefined, category: VENDOR_TRAP.category, severity: VENDOR_TRAP.severity, label: 'Trap SNMP de fabricante', summary: trapOid ? `OID ${trapOid}` : 'OID desconhecido', fields: {}, isClear: false, alertable: false };
  }
  const fields: Record<string, string | number> = {};
  const set = (key: string, value: string | number | undefined) => { if (value !== undefined && value !== '') fields[key] = value; };
  let severity: TrapSeverity = entry.severity;
  let recovered = false;
  let subject: string | undefined;
  let index: string | undefined;
  const parts: string[] = [];

  const envmon = (descrCol: string, stateCol: string, valueCol?: string, unit?: string) => {
    const descr = find(list, descrCol); const state = find(list, stateCol); const value = valueCol ? find(list, valueCol) : undefined;
    index = firstIndex(state?.index ?? descr?.index ?? value?.index ?? '');
    subject = text(descr?.value);
    const stateName = enumName(CISCO_ENV_MON_STATE, state?.value);
    set('descr', subject); set('state', stateName); set('index', index);
    if (value && num(value.value) !== undefined) { set('value', num(value.value)); parts.push(`valor ${num(value.value)}${unit ?? ''}`); }
    if (stateName) parts.push(`estado ${stateName}`);
    if (num(state?.value) === 1) recovered = true;
  };

  switch (entry.name) {
    case 'linkDown':
    case 'linkUp': {
      const ifIndex = find(list, O.ifIndex);
      const idx = num(ifIndex?.value) ?? num(firstIndex(ifIndex?.index ?? ''));
      index = idx !== undefined ? String(idx) : firstIndex(find(list, O.ifOperStatus)?.index ?? '');
      const name = text(find(list, O.ifName)?.value) ?? text(find(list, O.ifDescr)?.value);
      subject = name ?? (index ? `ifIndex ${index}` : undefined);
      set('ifIndex', index ? Number(index) : undefined); set('ifName', name);
      set('adminStatus', enumName(IF_STATUS, find(list, O.ifAdminStatus)?.value));
      set('operStatus', enumName(IF_STATUS, find(list, O.ifOperStatus)?.value));
      if (fields.adminStatus) parts.push(`admin ${fields.adminStatus}`);
      if (fields.operStatus) parts.push(`oper ${fields.operStatus}`);
      break;
    }
    case 'ciscoEnvMonVoltageNotification':
    case 'ciscoEnvMonVoltStatusChangeNotif':
      envmon(O.voltDescr, O.voltState, O.voltValue, ' mV'); break;
    case 'ciscoEnvMonTemperatureNotification':
    case 'ciscoEnvMonTempStatusChangeNotif':
      envmon(O.tempDescr, O.tempState, O.tempValue, ' °C'); break;
    case 'ciscoEnvMonFanNotification':
    case 'ciscoEnvMonFanStatusChangeNotif':
      envmon(O.fanDescr, O.fanState); break;
    case 'ciscoEnvMonRedundantSupplyNotification':
    case 'ciscoEnvMonSuppStatusChangeNotif':
      envmon(O.supplyDescr, O.supplyState); break;
    case 'entSensorThresholdNotification': {
      const value = find(list, O.entSensorValue); const threshold = find(list, O.entSensorThresholdValue);
      index = firstIndex(value?.index ?? threshold?.index ?? '');
      subject = index ? `entPhysicalIndex ${index}` : undefined;
      set('entPhysicalIndex', index ? Number(index) : undefined);
      set('sensorValue', num(value?.value)); set('thresholdValue', num(threshold?.value));
      const thresholdIndex = threshold?.index.split('.')[1]; set('thresholdIndex', thresholdIndex ? Number(thresholdIndex) : undefined);
      if (fields.sensorValue !== undefined) parts.push(`valor ${fields.sensorValue}`);
      if (fields.thresholdValue !== undefined) parts.push(`limiar ${fields.thresholdValue}`);
      break;
    }
    case 'cefcModuleStatusChange': {
      const status = find(list, O.cefcModuleOperStatus);
      index = firstIndex(status?.index ?? '');
      const name = enumName(CEFC_MODULE_OPER, status?.value);
      set('entPhysicalIndex', index ? Number(index) : undefined); set('operStatus', name);
      if (name) parts.push(`estado ${name}`);
      if (num(status?.value) === 2) recovered = true;
      break;
    }
    case 'cefcPowerStatusChange': {
      const oper = find(list, O.cefcFRUPowerOperStatus); const admin = find(list, O.cefcFRUPowerAdminStatus);
      index = firstIndex(oper?.index ?? admin?.index ?? '');
      set('entPhysicalIndex', index ? Number(index) : undefined);
      set('operStatus', enumName(CEFC_POWER_OPER, oper?.value)); set('adminStatus', enumName(CEFC_POWER_ADMIN, admin?.value));
      if (fields.operStatus) parts.push(`oper ${fields.operStatus}`);
      if (fields.adminStatus) parts.push(`admin ${fields.adminStatus}`);
      if (num(oper?.value) === 2) recovered = true;
      break;
    }
    case 'cefcFRUInserted':
    case 'cefcFRURemoved': {
      const contained = find(list, O.entPhysicalContainedIn);
      index = firstIndex(contained?.index ?? '');
      set('entPhysicalIndex', index ? Number(index) : undefined); set('containedIn', num(contained?.value));
      if (fields.containedIn !== undefined) parts.push(`contido em ${fields.containedIn}`);
      break;
    }
    case 'cefcUnrecognizedFRU':
    case 'cefcPowerSupplyOutputChange': {
      const name = find(list, O.entPhysicalName); const model = find(list, O.entPhysicalModelName);
      index = firstIndex(name?.index ?? model?.index ?? find(list, O.cefcPhysicalStatus)?.index ?? '');
      subject = text(name?.value);
      set('entPhysicalIndex', index ? Number(index) : undefined); set('name', subject); set('model', text(model?.value));
      set('physicalStatus', enumName(CEFC_PHYSICAL_STATUS, find(list, O.cefcPhysicalStatus)?.value));
      if (fields.model) parts.push(`modelo ${fields.model}`);
      if (fields.physicalStatus) parts.push(`estado ${fields.physicalStatus}`);
      break;
    }
    case 'cefcFanTrayStatusChange': {
      const status = find(list, O.cefcFanTrayOperStatus);
      index = firstIndex(status?.index ?? '');
      set('entPhysicalIndex', index ? Number(index) : undefined); set('operStatus', enumName(CEFC_FAN_TRAY_OPER, status?.value));
      if (fields.operStatus) parts.push(`estado ${fields.operStatus}`);
      if (num(status?.value) === 2) recovered = true;
      break;
    }
    case 'cswStackPortChange': {
      const port = find(list, O.cswStackPortOperStatus); const ifIndex = find(list, O.ifIndex); const sw = find(list, O.cswSwitchNumCurrent);
      index = firstIndex(port?.index ?? '') ?? (num(ifIndex?.value) !== undefined ? String(num(ifIndex?.value)) : undefined);
      set('ifIndex', index ? Number(index) : undefined); set('switchNumber', num(sw?.value)); set('operStatus', enumName(CSW_STACK_PORT_OPER, port?.value));
      subject = [fields.switchNumber !== undefined ? `Switch ${fields.switchNumber}` : undefined, index ? `porta de stack ifIndex ${index}` : undefined].filter(Boolean).join(' ') || undefined;
      if (fields.operStatus) parts.push(`estado ${fields.operStatus}`);
      if (num(port?.value) === 1) recovered = true;
      break;
    }
    case 'cswStackNewMaster':
    case 'cswStackMismatch':
    case 'cswStackNewMember':
    case 'cswStackMemberRemoved': {
      const sw = find(list, O.cswSwitchNumCurrent); const state = find(list, O.cswSwitchState); const role = find(list, O.cswSwitchRole);
      const switchNumber = num(sw?.value);
      index = switchNumber !== undefined ? String(switchNumber) : undefined;
      subject = index ? `Switch ${index}` : undefined;
      set('switchNumber', switchNumber); set('entPhysicalIndex', firstIndex(sw?.index ?? '') ? Number(firstIndex(sw!.index)) : undefined);
      set('switchState', enumName(CSW_SWITCH_STATE, state?.value)); set('switchRole', enumName(CSW_SWITCH_ROLE, role?.value));
      if (fields.switchState) parts.push(`estado ${fields.switchState}`);
      if (fields.switchRole) parts.push(`papel ${fields.switchRole}`);
      break;
    }
    case 'cswStackRingRedundant': {
      const ring = find(list, O.cswRingRedundant);
      index = 'ring';
      set('ringRedundant', enumName(TRUTH_VALUE, ring?.value));
      if (fields.ringRedundant) parts.push(`redundante ${fields.ringRedundant}`);
      if (num(ring?.value) === 1) recovered = true;
      break;
    }
    case 'cpmCPURisingThreshold':
    case 'cpmCPUFallingThreshold': {
      const total = find(list, O.cpmCPUTotalMonIntervalValue);
      const threshold = find(list, entry.name === 'cpmCPURisingThreshold' ? O.cpmCPURisingThresholdValue : O.cpmCPUFallingThresholdValue);
      index = firstIndex(total?.index ?? threshold?.index ?? '');
      subject = index ? `CPU ${index}` : undefined;
      set('cpuIndex', index ? Number(index) : undefined); set('utilization', num(total?.value)); set('threshold', num(threshold?.value));
      if (fields.utilization !== undefined) parts.push(`utilização ${fields.utilization}%`);
      if (fields.threshold !== undefined) parts.push(`limiar ${fields.threshold}%`);
      break;
    }
    case 'cempMemBufferNotify': {
      const name = find(list, O.cempMemBufferName); const peak = find(list, O.cempMemBufferPeak);
      subject = text(name?.value);
      set('buffer', subject); set('peak', num(peak?.value));
      if (fields.peak !== undefined) parts.push(`pico ${fields.peak}`);
      break;
    }
    case 'cErrDisableInterfaceEvent':
    case 'cErrDisableInterfaceEventRev1': {
      const cause = find(list, O.cErrDisableIfStatusCause);
      const [ifIndex, vlan] = (cause?.index ?? '').split('.');
      index = ifIndex || undefined;
      const name = text(find(list, O.ifName)?.value) ?? text(find(list, O.ifDescr)?.value);
      subject = name ?? (index ? `ifIndex ${index}` : undefined);
      set('ifIndex', index ? Number(index) : undefined); set('ifName', name); set('vlan', vlan && vlan !== '0' ? Number(vlan) : undefined);
      set('cause', enumName(ERR_DISABLE_CAUSE, cause?.value));
      if (fields.cause) parts.push(`causa ${fields.cause}`);
      if (fields.vlan !== undefined) parts.push(`VLAN ${fields.vlan}`);
      break;
    }
    case 'ccmCLIRunningConfigChanged':
    case 'ciscoConfigManEvent': {
      set('terminalType', enumName(CCM_TERMINAL_TYPE, find(list, O.ccmHistoryEventTerminalType)?.value));
      set('commandSource', enumName(CCM_COMMAND_SOURCE, find(list, O.ccmHistoryEventCommandSource)?.value));
      set('configSource', enumName(CCM_CONFIG_LOCATION, find(list, O.ccmHistoryEventConfigSource)?.value));
      set('configDestination', enumName(CCM_CONFIG_LOCATION, find(list, O.ccmHistoryEventConfigDestination)?.value));
      const user = text(find(list, O.ccmHistoryEventTerminalUser)?.value); set('user', user);
      if (fields.configSource && fields.configDestination) parts.push(`${fields.configSource} → ${fields.configDestination}`);
      if (fields.terminalType) parts.push(`terminal ${fields.terminalType}`);
      if (user) parts.push(`utilizador ${user}`);
      break;
    }
    default:
      break;
  }

  if (!subject && index && entry.clearScope === 'entity') subject = `entPhysicalIndex ${index}`;
  if (recovered) severity = 'INFO';
  const isClear = Boolean(entry.clears) || recovered;
  const label = recovered && entry.recoveredLabel ? entry.recoveredLabel : entry.label;
  return {
    known: true,
    oid: entry.oid,
    mib: entry.mib,
    name: entry.name,
    category: entry.category,
    severity,
    label,
    subject,
    summary: parts.join(' · ') || entry.name,
    fields,
    clearKey: entry.clearScope && index ? `${entry.clearScope}:${index}` : undefined,
    isClear,
    alertable: !entry.noAlert,
  };
}

/** Title for an operational alert, e.g. "Falha de ventoinha – Switch 1 - FAN 1". */
export function trapAlertTitle(decoded: DecodedTrap) {
  return decoded.subject ? `${decoded.label} – ${decoded.subject}` : decoded.label;
}

/** Notification OIDs that may represent a recovery (always, or when the decoded state is normal). */
export const RECOVERY_CAPABLE_TRAP_OIDS: readonly string[] = TRAP_CATALOG.filter((entry) => entry.clears || entry.recoveredLabel).map((entry) => entry.oid);
