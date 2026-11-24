'use client';

import type { DiscoveryHostOutcome, DiscoveryJob } from './api';

/**
 * D-P2a: structured scan outcomes, read-only. Each saved host shows what ICMP, every probed TCP port, reverse DNS and
 * SNMP saw; the run shows the same states counted over every scanned host, including the ones that did not answer
 * (they have no result row). Runs saved before D-P2a have neither and render as before.
 */

const icmpText: Record<DiscoveryHostOutcome['icmp'], string | null> = { REPLY: 'ICMP: respondeu', NO_REPLY: 'ICMP: sem resposta', ERROR: 'ICMP: erro na sonda', NOT_PROBED: null };
const tcpText: Record<NonNullable<DiscoveryHostOutcome['tcp']>[number]['state'], string> = { OPEN: 'aberta', REFUSED: 'recusada', TIMEOUT: 'sem resposta', ERROR: 'erro' };
const snmpText: Record<DiscoveryHostOutcome['snmp'], string | null> = {
  OK: 'SNMP: lido', PARTIAL: 'SNMP: leitura parcial', AUTH_FAILED: 'SNMP: autenticação falhou', TIMEOUT: 'SNMP: sem resposta', ERROR: 'SNMP: erro',
  SKIPPED_POLICY: 'SNMP: não tentado (política da execução)', NOT_ENABLED: null,
};
const tone = (good: boolean, bad: boolean) => good ? 'ok' : bad ? 'bad' : 'neutral';

function dnsText(outcome: DiscoveryHostOutcome): string | null {
  if (outcome.dns === 'PTR') return 'DNS: registo PTR encontrado';
  if (outcome.dns === 'NO_PTR') return 'DNS: sem registo PTR';
  if (outcome.dns === 'LOOKUP_FAILED') return `DNS: pesquisa falhou (${outcome.dnsError ?? 'DNS_LOOKUP_FAILED'})`;
  return null;
}

/** One line per method; methods the run did not use are left out. */
export function DiscoveryOutcomeCell({ outcome }: { outcome: DiscoveryHostOutcome }) {
  const lines: Array<{ key: string; text: string; tone: string }> = [];
  const icmp = icmpText[outcome.icmp];
  if (icmp) lines.push({ key: 'icmp', text: icmp, tone: tone(outcome.icmp === 'REPLY', outcome.icmp === 'ERROR') });
  for (const item of outcome.tcp ?? []) lines.push({ key: `tcp-${item.port}`, text: `TCP ${item.port}: ${tcpText[item.state]}`, tone: tone(item.state === 'OPEN', item.state === 'ERROR') });
  const dns = dnsText(outcome);
  if (dns) lines.push({ key: 'dns', text: dns, tone: tone(outcome.dns === 'PTR', outcome.dns === 'LOOKUP_FAILED') });
  const snmp = snmpText[outcome.snmp];
  if (snmp) lines.push({ key: 'snmp', text: snmp, tone: tone(outcome.snmp === 'OK', ['AUTH_FAILED', 'TIMEOUT', 'ERROR'].includes(outcome.snmp)) });
  return <ul className="discovery-outcome" aria-label="Resultado por método">
    {lines.map((line) => <li key={line.key} data-tone={line.tone}><small>{line.text}</small></li>)}
  </ul>;
}

/** Counts for the whole run; lines for methods with nothing counted are left out. */
export function DiscoveryRunOutcomeSummary({ job }: { job: Pick<DiscoveryJob, 'outcomeCounts' | 'totalCount' | 'processedCount'> }) {
  const counts = job.outcomeCounts;
  if (!counts) return null;
  const notScanned = Math.max(0, (job.totalCount ?? 0) - (job.processedCount ?? 0));
  const lines = [
    `Hosts: ${counts.responded} responderam · ${counts.noResponse} sem resposta · ${notScanned} não sondados`,
    counts.icmpReply + counts.icmpNoReply + counts.icmpError ? `ICMP: ${counts.icmpReply} respostas · ${counts.icmpNoReply} sem resposta · ${counts.icmpError} erros` : null,
    counts.tcpOpen + counts.tcpRefused + counts.tcpTimeout + counts.tcpError ? `Portas TCP: ${counts.tcpOpen} abertas · ${counts.tcpRefused} recusadas · ${counts.tcpTimeout} sem resposta · ${counts.tcpError} erros` : null,
    counts.dnsPtr + counts.dnsNoPtr + counts.dnsLookupFailed ? `DNS inverso: ${counts.dnsPtr} com PTR · ${counts.dnsNoPtr} sem PTR · ${counts.dnsLookupFailed} falhas` : null,
    counts.snmpOk + counts.snmpPartial + counts.snmpAuthFailed + counts.snmpTimeout + counts.snmpError + counts.snmpSkippedPolicy
      ? `SNMP: ${counts.snmpOk} lidos · ${counts.snmpPartial} parciais · ${counts.snmpAuthFailed} autenticação falhou · ${counts.snmpTimeout} sem resposta · ${counts.snmpError} erros · ${counts.snmpSkippedPolicy} não tentados (política)`
      : null,
  ].filter((line): line is string => Boolean(line));
  return <div className="discovery-outcome-summary" role="group" aria-label="Resultado por método">
    {lines.map((line) => <small key={line} className="muted-cell">{line}</small>)}
  </div>;
}
