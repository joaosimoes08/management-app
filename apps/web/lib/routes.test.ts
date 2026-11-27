import { describe, expect, it } from 'vitest';
import { deviceEditHref, entityHref } from './routes';

describe('entityHref', () => {
  it('uses the existing detail routes for devices, subnets and IPs', () => {
    expect(entityHref({ kind: 'device', id: 'd 1', siteId: 's1' })).toBe('/infraestrutura/equipamentos/d%201?siteId=s1');
    expect(deviceEditHref({ id: 'd 1', siteId: 's1' })).toBe('/infraestrutura?siteId=s1&tab=devices&deviceId=d+1&focus=device');
    expect(entityHref({ kind: 'subnet', id: 'n1', siteId: 's1' })).toBe('/ipam?siteId=s1&subnetId=n1');
    expect(entityHref({ kind: 'ip', id: 'ip1', subnetId: 'n1', siteId: 's1' })).toBe('/ipam?siteId=s1&subnetId=n1&ipId=ip1');
  });

  it('falls back to the list page with a search filter where no detail route exists', () => {
    expect(entityHref({ kind: 'ip', id: 'ip1', label: '10.0.0.1' })).toBe('/ipam?q=10.0.0.1');
    expect(entityHref({ kind: 'change', id: 'c1', label: 'Troca do core', siteId: 's1' })).toBe('/alteracoes?siteId=s1&q=Troca+do+core');
    expect(entityHref({ kind: 'change', id: 'c1' })).toBe('/alteracoes?q=c1');
    expect(entityHref({ kind: 'audit', id: 'evt-9', label: 'USER_UPDATED' })).toBe('/auditoria?q=evt-9');
    expect(entityHref({ kind: 'device', id: 'd1' })).toBe('/infraestrutura/equipamentos/d1');
  });
});
