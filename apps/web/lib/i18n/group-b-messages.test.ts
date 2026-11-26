import { describe, expect, it } from 'vitest';
import { translateMessage } from './i18n';
import { translateLegacyText } from './legacy-messages';
import { topologyToolbarSummary } from '@/features/topology/toolbar-summary';
import { discoveryJobProgress } from '@/features/discovery/api';
import { missingIpEvidence } from '@/features/discovery/discovery-missing';

const english = (key: string, fallback?: string, params?: Record<string, string | number>) => translateMessage('en-US', key, fallback, params);

describe('i18n group B (topology, quality, discovery, netapp)', () => {
  it('builds the topology toolbar summary in English', () => {
    expect(topologyToolbarSummary({ mapName: 'Core', nodeCount: 12, visibleCount: 4, filtering: true, connectionCount: 1, alertsUnavailable: false, problemCount: 2 }, english))
      .toBe('Core · 4 of 12 devices visible · 1 link · 2 active problems');
    expect(topologyToolbarSummary({ nodeCount: 1, visibleCount: 1, filtering: false, connectionCount: 0, alertsUnavailable: true, problemCount: 0 }, english))
      .toBe('No map selected · 1 device · 0 links · Alerts unavailable');
  });

  it('describes discovery progress and missing addresses in English', () => {
    expect(discoveryJobProgress({ status: 'RUNNING', totalCount: 62, processedCount: 32, stopReason: null, cancelRequestedAt: '2026-01-01T00:00:00Z' }, english))
      .toBe('32/62 addresses · cancellation requested');
    expect(missingIpEvidence({ lastSeenAt: null, lastScanAt: '2026-01-01', scanCount: 3 }, (value) => value, english))
      .toBe('never seen by a discovery · 3 discoveries without a reply · latest 2026-01-01');
  });

  it('keeps every group B key in both languages', () => {
    for (const key of ['groupB.alerts.resolveOne', 'groupB.audit.csvRows.other', 'groupB.assets.weekOf', 'groupB.snmp.stale']) {
      expect(translateMessage('pt-PT', key)).not.toBe(key);
      expect(translateMessage('en-US', key)).not.toBe(translateMessage('pt-PT', key));
    }
  });

  it('translates static topology, discovery and NetApp text through the legacy dictionary', () => {
    expect(translateLegacyText('en-US', 'Mapa do site')).toBe('Site map');
    expect(translateLegacyText('en-US', 'Liga de')).toBe('Connects from');
  });
});

describe('legacy substitution order', () => {
  it('translates specific sentences before the generic count rules can half-translate them', () => {
    expect(translateLegacyText('en-US', 'Ver 3 alertas ativos de Core')).toBe('View 3 active alerts of Core');
    expect(translateLegacyText('en-US', 'CSV exportado com 2 eventos.')).toBe('CSV exported with 2 events.');
    expect(translateLegacyText('en-US', '12 eventos carregados')).toBe('12 events loaded');
    expect(translateLegacyText('en-US', '4 de 12 equipamentos visíveis')).toBe('4 of 12 devices visible');
  });

  it('still applies the generic count rules on their own', () => {
    expect(translateLegacyText('en-US', '3 alertas ativos')).toBe('3 active alerts');
    expect(translateLegacyText('en-US', '12 equipamentos')).toBe('12 devices');
  });

  it('matches trimmed text, so rules no longer start with a space', () => {
    expect(translateLegacyText('en-US', ' Adiados até 26/11/2026, 10:00.')).toBe(' Snoozed until 26/11/2026, 10:00.');
    expect(translateLegacyText('en-US', ' · 3 selecionados')).toBe(' · 3 selected');
  });

  it('translates the bulk-review summary when the caller already passes an English noun', () => {
    expect(translateLegacyText('en-US', '5 drifts selecionados. Cada item é verificado à parte; uma falha não impede os restantes.'))
      .toBe('5 drifts selected. Each item is checked separately; one failure does not stop the others.');
  });
});

describe('group B keys replacing regex rules', () => {
  it('builds the SNMP credential delete confirmation from keys', async () => {
    const { snmpCredentialDeleteMessage, snmpCredentialUsage } = await import('@/features/snmp/snmp-credential-usage');
    const usage = snmpCredentialUsage('READ', { config: { enabled: true } } as never, english);
    expect(snmpCredentialDeleteMessage({ purpose: 'READ', version: 'V3', username: 'netops', label: null }, 'core-sw-01', usage, english)).toBe([
      'Delete the READ · V3 (netops) credential of core-sw-01?',
      'Only this credential is removed; the other credentials and the SNMP configuration stay as they are. This cannot be undone.',
      '',
      'Warning, this credential is in use:',
      '• SNMP polling is on for this device and uses this credential: it stops working until you save another READ credential.',
    ].join('\n'));
  });

  it('uses plural keys for counts', () => {
    expect(english('groupB.drifts.pageSummary', undefined, { page: 1, pages: 3, count: 1 })).toBe('1 / 3 · 1 drift');
    expect(english('groupB.drifts.pageSummary', undefined, { page: 1, pages: 3, count: 40 })).toBe('1 / 3 · 40 drifts');
    expect(translateMessage('pt-PT', 'groupB.drifts.pageSummary', undefined, { page: 1, pages: 3, count: 40 })).toBe('1 / 3 · 40 divergências');
  });
});
