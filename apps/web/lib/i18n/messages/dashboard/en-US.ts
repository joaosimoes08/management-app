/** Dashboard: English, also the fallback of the added languages. */
import type { DashboardMessageKey } from './pt-PT';

export const messages: Record<string, string> = {
  'dashboard.widget.active-alerts': 'Active alerts',
  'dashboard.widget.quality-queue': 'Data quality',
  'dashboard.widget.service-health': 'Service health',
  'dashboard.widget.recent-changes': 'Recent activity',
  'dashboard.widget.inventory-summary': 'Current distribution',
  'dashboard.widget.quick-actions': 'Quick access',
  'dashboard.widget.running-processes': 'Running processes',
  'dashboard.widget.discovery-review': 'Discovery to review or failed',
  'dashboard.widget.snmp-drifts': 'SNMP drifts',
} satisfies Record<DashboardMessageKey, string>;
