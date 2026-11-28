/** Dashboard: Italiano. Loaded only when it-IT is chosen. */
import type { DashboardMessageKey } from './pt-PT';

export const messages: Record<string, string> = {
  'dashboard.widget.active-alerts': 'Avvisi attivi',
  'dashboard.widget.quality-queue': 'Qualità dei dati',
  'dashboard.widget.service-health': 'Stato di salute dei servizi',
  'dashboard.widget.recent-changes': 'Attività recente',
  'dashboard.widget.inventory-summary': 'Distribuzione attuale',
  'dashboard.widget.quick-actions': 'Accesso rapido',
  'dashboard.widget.running-processes': 'Processi in esecuzione',
  'dashboard.widget.discovery-review': 'Rilevamenti da rivedere o non riusciti',
  'dashboard.widget.snmp-drifts': 'Derive SNMP',
} satisfies Record<DashboardMessageKey, string>;
