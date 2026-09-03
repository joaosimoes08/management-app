import { redactSecrets } from '@simoes/snmp-core';

export function log(level: 'info' | 'warn' | 'error', message: string, metadata: Record<string, unknown> = {}) {
  const output = JSON.stringify({ timestamp: new Date().toISOString(), level, component: 'snmp', message, ...redactSecrets(metadata) as object });
  if (level === 'error') console.error(output); else if (level === 'warn') console.warn(output); else console.info(output);
}

export function publicErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^SNMP_[A-Z0-9_]+$/.test(error.code)) return error.code;
  const message = error instanceof Error ? error.message : '';
  if (/timeout/i.test(message)) return 'SNMP_TIMEOUT';
  if (/authorization|authentication|unknown user|wrong digest/i.test(message)) return 'SNMP_AUTHENTICATION_FAILED';
  return 'SNMP_EXECUTION_FAILED';
}
