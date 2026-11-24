import { CAPACITY_ALERT_SOURCE } from './capacity-alerts';
import { HEALTH_ALERT_SOURCE } from './health-alerts';
import { INTERFACE_ALERT_SOURCE } from './interface-alerts';
import { TRAP_SOURCE_ALERT_SOURCE } from './trap-alerts';

/**
 * Alert sources the back end raises today. The alert-rule form offers these as "Tipo de evento";
 * GET /operations/alerts/sources adds any other source already stored, so a new producer shows up
 * without a change here.
 */
export const KNOWN_ALERT_SOURCES: readonly string[] = ['SNMP_TRAP', TRAP_SOURCE_ALERT_SOURCE, INTERFACE_ALERT_SOURCE, HEALTH_ALERT_SOURCE, 'SNMP_POLL', 'SNMP_DRIFT', CAPACITY_ALERT_SOURCE, 'DISCOVERY', 'INVENTORY_QUALITY', 'SYSTEM_HEALTH'];
