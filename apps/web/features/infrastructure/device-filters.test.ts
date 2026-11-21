import { describe, expect, it } from 'vitest';
import { clearDeviceUrlFilters, deviceFilterLabels, deviceFilterQuery, hasDeviceUrlFilters, readDeviceUrlFilters } from './device-filters';
import { clearSubnetUrlFilters, hasSubnetUrlFilters, readSubnetUrlFilters, subnetFilterLabels, subnetFilterQuery } from '@/features/ipam/subnet-filters';

describe('device URL filters', () => {
  it('reads the drill-through filters and forwards them to GET /devices', () => {
    const filters = readDeviceUrlFilters('?siteId=s1&tab=devices&status=ACTIVE,MAINTENANCE&critical=true&lifecycle=due:90');
    expect(filters).toEqual({ status: 'ACTIVE,MAINTENANCE', critical: 'true', lifecycle: 'due:90', lifecycleKind: '', tier: '' });
    expect(hasDeviceUrlFilters(filters)).toBe(true);
    expect(deviceFilterQuery(filters)).toBe('&status=ACTIVE%2CMAINTENANCE&critical=true&lifecycle=due%3A90');
    expect(deviceFilterLabels(filters)).toEqual(['Estado: Ativo, Em manutenção', 'Críticos', 'Ciclo de vida nos próximos 90 dias']);
    expect(deviceFilterLabels({ ...filters, status: '', critical: '', lifecycle: 'overdue', lifecycleKind: 'SUPPORT' })).toEqual(['Ciclo de vida expirado', 'Tipo de data: SUPPORT']);
  });

  it('clears only the filters and keeps the other parameters', () => {
    expect(clearDeviceUrlFilters('?siteId=s1&tab=devices&status=ACTIVE&lifecycle=overdue')).toBe('?siteId=s1&tab=devices');
    expect(hasDeviceUrlFilters(readDeviceUrlFilters('?siteId=s1'))).toBe(false);
  });
});

describe('subnet URL filters', () => {
  it('reads band, minUtilization and the API sort value', () => {
    const filters = readSubnetUrlFilters('?tab=subnets&band=WARNING,CRITICAL&minUtilization=80&sort=utilization');
    expect(hasSubnetUrlFilters(filters)).toBe(true);
    expect(subnetFilterQuery(filters)).toBe('&band=WARNING%2CCRITICAL&minUtilization=80&sort=utilization');
    expect(subnetFilterLabels(filters)).toEqual(['Ocupação: Aviso (≥ 80%), Crítico (≥ 90%)', 'Ocupação mínima: 80%', 'Ordenadas por ocupação']);
    expect(clearSubnetUrlFilters('?siteId=s1&tab=subnets&band=OK&sort=cidr')).toBe('?siteId=s1&tab=subnets');
  });
});

describe('criticality tier filter', () => {
  it('forwards the tier and labels it', () => {
    const filters = { ...readDeviceUrlFilters('?tier=T1'), critical: '' };
    expect(filters.tier).toBe('T1');
    expect(deviceFilterQuery(filters)).toBe('&tier=T1');
    expect(deviceFilterLabels(filters)).toEqual(['Criticidade: T1']);
  });
});
