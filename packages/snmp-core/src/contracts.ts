export const SNMP_QUEUE = 'snmp';
export const SNMP_CONTRACT_VERSION = 1 as const;

export const SNMP_JOB_NAMES = {
  poll: 'poll-device',
  pollJob: 'poll-job',
  credentialTest: 'test-credential',
  set: 'execute-set',
  processTrap: 'process-trap',
  reloadCredentials: 'reload-trap-credentials',
  cleanup: 'cleanup-expired-traps',
} as const;

export type SnmpQueueJobName = (typeof SNMP_JOB_NAMES)[keyof typeof SNMP_JOB_NAMES];
export type SnmpQueuePayload = { schemaVersion: typeof SNMP_CONTRACT_VERSION; recordId: string };

export function snmpPayload(recordId: string): SnmpQueuePayload {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recordId)) {
    throw new Error('SNMP_RECORD_ID_INVALID');
  }
  return { schemaVersion: SNMP_CONTRACT_VERSION, recordId };
}

export function assertSnmpPayload(input: unknown): asserts input is SnmpQueuePayload {
  if (!input || typeof input !== 'object') throw new Error('SNMP_JOB_PAYLOAD_INVALID');
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== SNMP_CONTRACT_VERSION || typeof value.recordId !== 'string') throw new Error('SNMP_JOB_PAYLOAD_INVALID');
  snmpPayload(value.recordId);
}

export const SNMP_OIDS = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysObjectId: '1.3.6.1.2.1.1.2.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  sysLocation: '1.3.6.1.2.1.1.6.0',
  ifTable: '1.3.6.1.2.1.2.2.1',
  ifXTable: '1.3.6.1.2.1.31.1.1.1',
  ifAdminStatus: '1.3.6.1.2.1.2.2.1.7',
  snmpTrapOid: '1.3.6.1.6.3.1.1.4.1.0',
} as const;

export type SnmpSetTemplate =
  | { operation: 'INTERFACE_ADMIN_STATUS'; interfaceId: string; adminUp: boolean }
  | { operation: 'SYSTEM_IDENTITY'; sysName?: string; sysLocation?: string };

export function validateSetTemplate(input: unknown): SnmpSetTemplate {
  if (!input || typeof input !== 'object') throw new Error('SNMP_SET_TEMPLATE_INVALID');
  const value = input as Record<string, unknown>;
  if (value.operation === 'INTERFACE_ADMIN_STATUS') {
    if (typeof value.interfaceId !== 'string' || typeof value.adminUp !== 'boolean') throw new Error('SNMP_SET_TEMPLATE_INVALID');
    snmpPayload(value.interfaceId);
    return { operation: value.operation, interfaceId: value.interfaceId, adminUp: value.adminUp };
  }
  if (value.operation === 'SYSTEM_IDENTITY') {
    const sysName = typeof value.sysName === 'string' ? value.sysName.trim() : undefined;
    const sysLocation = typeof value.sysLocation === 'string' ? value.sysLocation.trim() : undefined;
    if (!sysName && !sysLocation) throw new Error('SNMP_SET_TEMPLATE_INVALID');
    if ((sysName?.length ?? 0) > 255 || (sysLocation?.length ?? 0) > 255) throw new Error('SNMP_SET_TEMPLATE_INVALID');
    return { operation: value.operation, ...(sysName ? { sysName } : {}), ...(sysLocation ? { sysLocation } : {}) };
  }
  throw new Error('SNMP_SET_OPERATION_FORBIDDEN');
}
