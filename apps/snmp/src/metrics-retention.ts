export function metricsRetentionDays(value = process.env.SNMP_METRICS_RETENTION_DAYS): number {
  if (value === undefined || value === '') return 90;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw Object.assign(new Error('SNMP_METRICS_RETENTION_DAYS_INVALID'), { code: 'SNMP_METRICS_RETENTION_DAYS_INVALID' });
  }
  return days;
}
