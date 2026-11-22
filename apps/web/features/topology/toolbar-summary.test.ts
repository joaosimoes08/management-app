import { describe, expect, it } from 'vitest';
import { topologyToolbarSummary } from './toolbar-summary';

describe('topologyToolbarSummary', () => {
  const base = { nodeCount: 0, visibleCount: 0, filtering: false, connectionCount: 0, alertsUnavailable: false, problemCount: 0 };

  it('describes the empty state on one line', () => {
    expect(topologyToolbarSummary(base)).toBe('Nenhum mapa selecionado · 0 equipamentos · 0 ligações · 0 problemas ativos');
  });

  it('counts visible devices while filtering and reports unavailable alerts', () => {
    expect(topologyToolbarSummary({ ...base, mapName: 'Core', nodeCount: 12, visibleCount: 4, filtering: true, connectionCount: 9, alertsUnavailable: true }))
      .toBe('Core · 4 de 12 equipamentos visíveis · 9 ligações · Alertas indisponíveis');
  });
});
