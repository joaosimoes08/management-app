/** Dashboard: Français. Loaded only when fr-FR is chosen. */
import type { DashboardMessageKey } from './pt-PT';

export const messages: Record<string, string> = {
  'dashboard.widget.active-alerts': 'Alertes actives',
  'dashboard.widget.quality-queue': 'Qualité des données',
  'dashboard.widget.service-health': 'Santé des services',
  'dashboard.widget.recent-changes': 'Activité récente',
  'dashboard.widget.inventory-summary': 'Répartition actuelle',
  'dashboard.widget.quick-actions': 'Accès rapide',
  'dashboard.widget.running-processes': 'Processus en cours d’exécution',
  'dashboard.widget.discovery-review': 'Découverte à revoir ou en échec',
  'dashboard.widget.snmp-drifts': 'Dérives SNMP',
} satisfies Record<DashboardMessageKey, string>;
