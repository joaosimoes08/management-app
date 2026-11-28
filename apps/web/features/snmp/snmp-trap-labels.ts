import type { useUiText } from '@/components/ui/use-ui-text';

type Translate = ReturnType<typeof useUiText>;

/**
 * Message keys for the raw trap kind (category) and status codes the API returns (texts in messages/snmp), so a raw
 * code such as VENDOR or PROCESSED never reaches the screen. Unknown codes fall back to the code itself so a new value
 * from the API stays visible.
 */
export const snmpTrapCategoryLabels: Record<string, string> = {
  AUTHENTICATION_FAILURE: 'snmp.traps.category.authenticationFailure',
  COLD_START: 'snmp.traps.category.coldStart',
  WARM_START: 'snmp.traps.category.warmStart',
  LINK_DOWN: 'snmp.traps.category.linkDown',
  LINK_UP: 'snmp.traps.category.linkUp',
  CONFIG_CHANGE: 'snmp.traps.category.configChange',
  CONFIG_EVENT: 'snmp.traps.category.configEvent',
  CPU_THRESHOLD_RISING: 'snmp.traps.category.cpuThresholdRising',
  CPU_THRESHOLD_FALLING: 'snmp.traps.category.cpuThresholdFalling',
  ENV_FAN: 'snmp.traps.category.envFan',
  ENV_POWER_SUPPLY: 'snmp.traps.category.envPowerSupply',
  ENV_SHUTDOWN: 'snmp.traps.category.envShutdown',
  ENV_TEMPERATURE: 'snmp.traps.category.envTemperature',
  ENV_VOLTAGE: 'snmp.traps.category.envVoltage',
  ERR_DISABLE: 'snmp.traps.category.errDisable',
  FRU_FAN_TRAY: 'snmp.traps.category.fruFanTray',
  FRU_INSERTED: 'snmp.traps.category.fruInserted',
  FRU_MODULE: 'snmp.traps.category.fruModule',
  FRU_POWER: 'snmp.traps.category.fruPower',
  FRU_PSU_OUTPUT: 'snmp.traps.category.fruPsuOutput',
  FRU_REMOVED: 'snmp.traps.category.fruRemoved',
  FRU_UNRECOGNIZED: 'snmp.traps.category.fruUnrecognized',
  MEMORY_BUFFER: 'snmp.traps.category.memoryBuffer',
  SENSOR_THRESHOLD: 'snmp.traps.category.sensorThreshold',
  STACK_MEMBER_REMOVED: 'snmp.traps.category.stackMemberRemoved',
  STACK_MISMATCH: 'snmp.traps.category.stackMismatch',
  STACK_NEW_MASTER: 'snmp.traps.category.stackNewMaster',
  STACK_NEW_MEMBER: 'snmp.traps.category.stackNewMember',
  STACK_PORT: 'snmp.traps.category.stackPort',
  STACK_POWER: 'snmp.traps.category.stackPower',
  STACK_RING: 'snmp.traps.category.stackRing',
  VENDOR: 'snmp.traps.category.vendor',
  SELF_TEST: 'snmp.traps.category.selfTest',
};

export const snmpTrapStatusLabels: Record<string, string> = {
  PENDING: 'snmp.traps.status.pending',
  PROCESSED: 'snmp.traps.status.processed',
  UNMATCHED: 'snmp.traps.status.unmatched',
  FAILED: 'snmp.traps.status.failed',
  DISCOVERED: 'snmp.traps.status.discovered',
  REJECTED: 'snmp.traps.status.rejected',
  IGNORED: 'snmp.traps.status.ignored',
};

export const snmpTrapCategoryLabel = (t: Translate, category?: string | null): string | null => {
  if (!category) return null;
  const key = snmpTrapCategoryLabels[category];
  return key ? t(key) : category;
};
export const snmpTrapStatusLabel = (t: Translate, status: string): string => {
  const key = snmpTrapStatusLabels[status];
  return key ? t(key) : status;
};
