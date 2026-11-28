'use client';

import type { DiscoveryHostOutcome, DiscoveryJob } from './api';
import { useUiText } from '@/components/ui/use-ui-text';

/**
 * D-P2a: structured scan outcomes, read-only. Each saved host shows what ICMP, every probed TCP port, reverse DNS and
 * SNMP saw; the run shows the same states counted over every scanned host, including the ones that did not answer
 * (they have no result row). Runs saved before D-P2a have neither and render as before.
 */

const icmpText: Record<DiscoveryHostOutcome['icmp'], string | null> = { REPLY: 'discovery.outcomes.icmp.reply', NO_REPLY: 'discovery.outcomes.icmp.noReply', ERROR: 'discovery.outcomes.icmp.error', NOT_PROBED: null };
const tcpText: Record<NonNullable<DiscoveryHostOutcome['tcp']>[number]['state'], string> = { OPEN: 'discovery.outcomes.tcp.open', REFUSED: 'discovery.outcomes.tcp.refused', TIMEOUT: 'discovery.outcomes.tcp.timeout', ERROR: 'discovery.outcomes.tcp.error' };
const snmpText: Record<DiscoveryHostOutcome['snmp'], string | null> = {
  OK: 'discovery.outcomes.snmp.ok', PARTIAL: 'discovery.outcomes.snmp.partial', AUTH_FAILED: 'discovery.outcomes.snmp.authFailed', TIMEOUT: 'discovery.outcomes.snmp.timeout', ERROR: 'discovery.outcomes.snmp.error',
  SKIPPED_POLICY: 'discovery.outcomes.snmp.skippedPolicy', NOT_ENABLED: null,
};
const tone = (good: boolean, bad: boolean) => good ? 'ok' : bad ? 'bad' : 'neutral';

function dnsText(t: ReturnType<typeof useUiText>, outcome: DiscoveryHostOutcome): string | null {
  if (outcome.dns === 'PTR') return t('discovery.outcomes.dns.ptr');
  if (outcome.dns === 'NO_PTR') return t('discovery.outcomes.dns.noPtr');
  if (outcome.dns === 'LOOKUP_FAILED') return t('discovery.outcomes.dns.lookupFailed', undefined, { error: outcome.dnsError ?? 'DNS_LOOKUP_FAILED' });
  return null;
}

/** One line per method; methods the run did not use are left out. */
export function DiscoveryOutcomeCell({ outcome }: { outcome: DiscoveryHostOutcome }) {
  const t = useUiText();
  const lines: Array<{ key: string; text: string; tone: string }> = [];
  const icmpKey = icmpText[outcome.icmp];
  const icmp = icmpKey ? t(icmpKey) : null;
  if (icmp) lines.push({ key: 'icmp', text: icmp, tone: tone(outcome.icmp === 'REPLY', outcome.icmp === 'ERROR') });
  for (const item of outcome.tcp ?? []) lines.push({ key: `tcp-${item.port}`, text: t('discovery.outcomes.tcpLine', undefined, { port: item.port, state: t(tcpText[item.state]) }), tone: tone(item.state === 'OPEN', item.state === 'ERROR') });
  const dns = dnsText(t, outcome);
  if (dns) lines.push({ key: 'dns', text: dns, tone: tone(outcome.dns === 'PTR', outcome.dns === 'LOOKUP_FAILED') });
  const snmpKey = snmpText[outcome.snmp];
  const snmp = snmpKey ? t(snmpKey) : null;
  if (snmp) lines.push({ key: 'snmp', text: snmp, tone: tone(outcome.snmp === 'OK', ['AUTH_FAILED', 'TIMEOUT', 'ERROR'].includes(outcome.snmp)) });
  return <ul className="discovery-outcome" aria-label={t('discovery.outcomes.outcomeByMethod')}>
    {lines.map((line) => <li key={line.key} data-tone={line.tone}><small>{line.text}</small></li>)}
  </ul>;
}

/** Counts for the whole run; lines for methods with nothing counted are left out. */
export function DiscoveryRunOutcomeSummary({ job }: { job: Pick<DiscoveryJob, 'outcomeCounts' | 'totalCount' | 'processedCount'> }) {
  const t = useUiText();
  const counts = job.outcomeCounts;
  if (!counts) return null;
  const notScanned = Math.max(0, (job.totalCount ?? 0) - (job.processedCount ?? 0));
  const lines = [
    t('discovery.outcomes.summary.hosts', undefined, { responded: counts.responded, noResponse: counts.noResponse, notScanned }),
    counts.icmpReply + counts.icmpNoReply + counts.icmpError ? t('discovery.outcomes.summary.icmp', undefined, { reply: counts.icmpReply, noReply: counts.icmpNoReply, error: counts.icmpError }) : null,
    counts.tcpOpen + counts.tcpRefused + counts.tcpTimeout + counts.tcpError ? t('discovery.outcomes.summary.tcp', undefined, { open: counts.tcpOpen, refused: counts.tcpRefused, timeout: counts.tcpTimeout, error: counts.tcpError }) : null,
    counts.dnsPtr + counts.dnsNoPtr + counts.dnsLookupFailed ? t('discovery.outcomes.summary.dns', undefined, { ptr: counts.dnsPtr, noPtr: counts.dnsNoPtr, failed: counts.dnsLookupFailed }) : null,
    counts.snmpOk + counts.snmpPartial + counts.snmpAuthFailed + counts.snmpTimeout + counts.snmpError + counts.snmpSkippedPolicy
      ? t('discovery.outcomes.summary.snmp', undefined, { ok: counts.snmpOk, partial: counts.snmpPartial, authFailed: counts.snmpAuthFailed, timeout: counts.snmpTimeout, error: counts.snmpError, skipped: counts.snmpSkippedPolicy })
      : null,
  ].filter((line): line is string => Boolean(line));
  return <div className="discovery-outcome-summary" role="group" aria-label={t('discovery.outcomes.outcomeByMethod')}>
    {lines.map((line) => <small key={line} className="muted-cell">{line}</small>)}
  </div>;
}
