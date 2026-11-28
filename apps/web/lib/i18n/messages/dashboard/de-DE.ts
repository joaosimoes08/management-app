/** Dashboard: Deutsch. Loaded only when de-DE is chosen. */
import type { DashboardMessageKey } from './pt-PT';

export const messages: Record<string, string> = {
  'dashboard.widget.active-alerts': 'Aktive Alarme',
  'dashboard.widget.quality-queue': 'Datenqualität',
  'dashboard.widget.service-health': 'Dienstzustand',
  'dashboard.widget.recent-changes': 'Letzte Aktivität',
  'dashboard.widget.inventory-summary': 'Aktuelle Verteilung',
  'dashboard.widget.quick-actions': 'Schnellzugriff',
  'dashboard.widget.running-processes': 'Laufende Prozesse',
  'dashboard.widget.discovery-review': 'Discovery zu prüfen oder fehlgeschlagen',
  'dashboard.widget.snmp-drifts': 'SNMP-Abweichungen',
} satisfies Record<DashboardMessageKey, string>;
