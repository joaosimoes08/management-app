/** One-line map summary for the topology toolbar; the toolbar truncates it and shows the full text as a tooltip. */
export function topologyToolbarSummary(input: { mapName?: string; nodeCount: number; visibleCount: number; filtering: boolean; connectionCount: number; alertsUnavailable: boolean; problemCount: number }): string {
  const devices = input.filtering ? `${input.visibleCount} de ${input.nodeCount} equipamentos visíveis` : `${input.nodeCount} equipamentos`;
  const problems = input.alertsUnavailable ? 'Alertas indisponíveis' : `${input.problemCount} problemas ativos`;
  return [input.mapName ?? 'Nenhum mapa selecionado', devices, `${input.connectionCount} ligações`, problems].join(' · ');
}
