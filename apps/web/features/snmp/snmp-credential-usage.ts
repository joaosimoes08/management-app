import { translateMessage } from '@/lib/i18n/i18n';
import type { SnmpCredentialPurpose, SnmpCredentialSummary, SnmpOverview } from './api';

type Translate = (key: string, fallback?: string, params?: Record<string, string | number>) => string;
const portuguese: Translate = (key, fallback, params) => translateMessage('pt-PT', key, fallback, params);

/**
 * Why deleting this credential would break something right now (one sentence each, in the language of `t`).
 * Empty list = not in use. Mirrors what the API uses each purpose for: READ for polling,
 * TRAP for validating SNMPv3 traps, WRITE for SNMP SET changes.
 */
export function snmpCredentialUsage(purpose: SnmpCredentialPurpose, overview?: Pick<SnmpOverview, 'config' | 'lastTrapReceivedAt' | 'setEnabled'> | null, t: Translate = portuguese): string[] {
  if (!overview) return [];
  const reasons: string[] = [];
  if (purpose === 'READ' && overview.config?.enabled) reasons.push(t('groupB.snmp.usageRead'));
  if (purpose === 'TRAP' && overview.lastTrapReceivedAt) reasons.push(t('groupB.snmp.usageTrap'));
  if (purpose === 'WRITE' && overview.setEnabled) reasons.push(t('groupB.snmp.usageWrite'));
  return reasons;
}

/** A queued or running job may be using the credential, so delete is refused until it finishes. */
export function snmpCredentialBusy(overview?: Pick<SnmpOverview, 'jobs'> | null): boolean {
  return Boolean(overview?.jobs?.some((job) => job.status === 'PENDING' || job.status === 'RUNNING'));
}

/** Confirmation text for deleting exactly one credential (this device, this purpose). */
export function snmpCredentialDeleteMessage(item: Pick<SnmpCredentialSummary, 'purpose' | 'version' | 'username' | 'label'>, deviceName: string | undefined, usage: string[], t: Translate = portuguese): string {
  const who = item.username || item.label;
  const target = who ? t('groupB.snmp.credentialTargetWho', undefined, { purpose: item.purpose, version: item.version, who }) : t('groupB.snmp.credentialTarget', undefined, { purpose: item.purpose, version: item.version });
  const lines = [deviceName ? t('groupB.snmp.deleteConfirmDevice', undefined, { target, device: deviceName }) : t('groupB.snmp.deleteConfirmThis', undefined, { target }), t('groupB.snmp.deleteConfirmScope')];
  if (usage.length) lines.push('', t('groupB.snmp.inUse'), ...usage.map((reason) => t('groupB.snmp.usageBullet', undefined, { reason })));
  return lines.join('\n');
}
