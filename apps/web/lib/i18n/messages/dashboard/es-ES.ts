/** Dashboard: Español. Loaded only when es-ES is chosen. */
import type { DashboardMessageKey } from './pt-PT';

export const messages: Record<string, string> = {
  'dashboard.widget.active-alerts': 'Alertas activas',
  'dashboard.widget.quality-queue': 'Calidad de los datos',
  'dashboard.widget.service-health': 'Salud de los servicios',
  'dashboard.widget.recent-changes': 'Actividad reciente',
  'dashboard.widget.inventory-summary': 'Distribución actual',
  'dashboard.widget.quick-actions': 'Acceso rápido',
  'dashboard.widget.running-processes': 'Procesos en ejecución',
  'dashboard.widget.discovery-review': 'Descubrimiento por revisar o con error',
  'dashboard.widget.snmp-drifts': 'Desviaciones SNMP',
} satisfies Record<DashboardMessageKey, string>;
