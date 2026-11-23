import { CAPACITY_ALERT_SOURCE } from './capacity-alerts';
import { INTERFACE_ALERT_SOURCE } from './interface-alerts';

/**
 * Alert sources the back end raises today. The alert-rule form offers these as "Tipo de evento";
 * GET /operations/alerts/sources adds any other source already stored, so a new producer shows up
 * without a change here.
 */
export const KNOWN_ALERT_SOURCES: readonly string[] = ['SNMP_TRAP', INTERFACE_ALERT_SOURCE, 'SNMP_POLL', 'SNMP_DRIFT', CAPACITY_ALERT_SOURCE, 'DISCOVERY', 'INVENTORY_QUALITY', 'SYSTEM_HEALTH'];
