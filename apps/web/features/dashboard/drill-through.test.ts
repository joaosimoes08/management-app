import { describe, expect, it } from 'vitest';
import { alertListHref, auditHref, changePlansHref, deviceListHref, discoveryJobsHref, hrefWith, qualityListHref, severityTileHref, subnetListHref, widgetLabel } from './drill-through';

describe('dashboard drill-through links', () => {
  it('leaves out empty values', () => {
    expect(hrefWith('/x', { a: '', b: undefined, c: null, d: false, e: 0, f: 'y' })).toBe('/x?e=0&f=y');
    expect(hrefWith('/x')).toBe('/x');
  });

  it('builds the device, subnet, discovery and audit list URLs with the API filter names', () => {
    expect(deviceListHref('s1', { status: 'ACTIVE,MAINTENANCE', critical: true, lifecycle: 'due:90', lifecycleKind: 'SUPPORT' }))
      .toBe('/infraestrutura?siteId=s1&tab=devices&status=ACTIVE%2CMAINTENANCE&critical=true&lifecycle=due%3A90&lifecycleKind=SUPPORT');
    expect(subnetListHref('s1', { minUtilization: 80, sort: 'utilization' })).toBe('/ipam?siteId=s1&tab=subnets&minUtilization=80&sort=utilization');
    expect(discoveryJobsHref({ status: 'PENDING,RUNNING' })).toBe('/descoberta?status=PENDING%2CRUNNING');
    expect(auditHref({ entityType: 'Device', event: 'e1' })).toBe('/auditoria?entityType=Device&event=e1');
    expect(auditHref({ entityType: null })).toBe('/auditoria');
  });

  it('uses the quality, change and alert URL state names', () => {
    expect(qualityListHref('s1', { status: 'OPEN', severity: 'HIGH', rule: 'MISSING_SERIAL' })).toBe('/qualidade-inventario?siteId=s1&status=OPEN&severity=HIGH&rule=MISSING_SERIAL');
    expect(changePlansHref('s1', { status: 'SUBMITTED' })).toBe('/alteracoes?siteId=s1&status=SUBMITTED');
    expect(alertListHref('s1', { severity: 'CRITICAL' })).toBe('/alertas?siteId=s1&severity=CRITICAL');
    expect(alertListHref('s1', { source: 'SNMP_DRIFT', scope: 'all' })).toBe('/alertas?source=SNMP_DRIFT&scope=all');
  });

  it('sends a severity tile to alerts unless only quality findings have that severity', () => {
    expect(severityTileHref('s1', 'HIGH', { alerts: 1, quality: 4 })).toBe('/alertas?siteId=s1&severity=HIGH');
    expect(severityTileHref('s1', 'HIGH', { alerts: 0, quality: 0 })).toBe('/alertas?siteId=s1&severity=HIGH');
    expect(severityTileHref('s1', 'INFO', { alerts: 0, quality: 2 })).toBe('/qualidade-inventario?siteId=s1&severity=INFO');
  });

  it('names known widgets and falls back to the id for new ones', () => {
    expect(widgetLabel('running-processes')).toBe('Processos em execução');
    expect(widgetLabel('new-widget')).toBe('new-widget');
  });
});
