/** Dashboard: Portuguese, the source language. Every other locale file has exactly these keys. */
export const messages = {
  'dashboard.widget.active-alerts': 'Alertas ativos',
  'dashboard.widget.quality-queue': 'Qualidade dos dados',
  'dashboard.widget.service-health': 'Saúde dos serviços',
  'dashboard.widget.recent-changes': 'Atividade recente',
  'dashboard.widget.inventory-summary': 'Distribuição atual',
  'dashboard.widget.quick-actions': 'Acesso rápido',
  'dashboard.widget.running-processes': 'Processos em execução',
  'dashboard.widget.discovery-review': 'Discovery a rever ou falhado',
  'dashboard.widget.snmp-drifts': 'Divergências SNMP',
} as const satisfies Record<string, string>;

export type DashboardMessageKey = keyof typeof messages;
