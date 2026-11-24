import type { SnmpCredentialPurpose, SnmpCredentialSummary, SnmpOverview } from './api';

/**
 * Why deleting this credential would break something right now (pt-PT, one sentence each).
 * Empty list = not in use. Mirrors what the API uses each purpose for: READ for polling,
 * TRAP for validating SNMPv3 traps, WRITE for SNMP SET changes.
 */
export function snmpCredentialUsage(purpose: SnmpCredentialPurpose, overview?: Pick<SnmpOverview, 'config' | 'lastTrapReceivedAt' | 'setEnabled'> | null): string[] {
  if (!overview) return [];
  const reasons: string[] = [];
  if (purpose === 'READ' && overview.config?.enabled) reasons.push('A recolha SNMP deste equipamento está ativa e usa esta credencial: deixa de funcionar até guardares outra credencial READ.');
  if (purpose === 'TRAP' && overview.lastTrapReceivedAt) reasons.push('Este equipamento já enviou traps: as próximas traps SNMPv3 deixam de ser validadas até guardares outra credencial TRAP.');
  if (purpose === 'WRITE' && overview.setEnabled) reasons.push('As alterações SNMP (SET) estão ativas: deixam de poder ser executadas neste equipamento até guardares outra credencial WRITE.');
  return reasons;
}

/** A queued or running job may be using the credential, so delete is refused until it finishes. */
export function snmpCredentialBusy(overview?: Pick<SnmpOverview, 'jobs'> | null): boolean {
  return Boolean(overview?.jobs?.some((job) => job.status === 'PENDING' || job.status === 'RUNNING'));
}

/** Confirmation text for deleting exactly one credential (this device, this purpose). */
export function snmpCredentialDeleteMessage(item: Pick<SnmpCredentialSummary, 'purpose' | 'version' | 'username' | 'label'>, deviceName: string | undefined, usage: string[]): string {
  const who = item.username || item.label;
  const target = `${item.purpose} · ${item.version}${who ? ` (${who})` : ''}`;
  const lines = [`Eliminar a credencial ${target} ${deviceName ? `de ${deviceName}` : 'deste equipamento'}?`, 'Só esta credencial é removida; as outras credenciais e a configuração SNMP ficam como estão. Não é possível desfazer.'];
  if (usage.length) lines.push('', 'Atenção, esta credencial está em uso:', ...usage.map((reason) => `• ${reason}`));
  return lines.join('\n');
}
