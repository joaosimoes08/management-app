import { describe, expect, it } from 'vitest';
import { auditQueryString } from './api';
import { auditEntityRef, auditQueryFrom, dayBoundary, emptyAuditFilters, formatAuditValue, hasAuditFilters, metadataEntries } from './workspace';

describe('auditQueryFrom', () => {
  it('hides HTTP request noise by default and drops empty filters', () => {
    expect(auditQueryFrom('  ', emptyAuditFilters)).toEqual({ q: undefined, action: undefined, entityType: undefined, actorId: undefined, from: undefined, to: undefined, excludeHttp: true });
  });

  it('maps the URL filters to the server names and local day boundaries', () => {
    const query = auditQueryFrom(' sw-01 ', { ...emptyAuditFilters, action: 'DEVICE_UPDATED', entityType: 'Device', actor: 'user-1', from: '2026-11-01', to: '2026-11-02', http: '1' });
    expect(query).toMatchObject({ q: 'sw-01', action: 'DEVICE_UPDATED', entityType: 'Device', actorId: 'user-1', excludeHttp: undefined });
    expect(new Date(query.from!).getTime()).toBe(new Date(2026, 10, 1, 0, 0, 0, 0).getTime());
    expect(new Date(query.to!).getTime()).toBe(new Date(2026, 10, 2, 23, 59, 59, 999).getTime());
  });

  it('ignores malformed dates instead of sending them', () => {
    expect(dayBoundary('2026-13', 'start')).toBeUndefined();
    expect(dayBoundary('', 'end')).toBeUndefined();
  });

  it('serialises only set values, with the cursor and limit as extras', () => {
    expect(auditQueryString({ q: 'x', excludeHttp: true, action: undefined }, { limit: '50', cursor: undefined })).toBe('q=x&excludeHttp=true&limit=50');
  });

  it('does not count the HTTP toggle or the open event as narrowing filters', () => {
    expect(hasAuditFilters('', { ...emptyAuditFilters, http: '1', event: 'e1' })).toBe(false);
    expect(hasAuditFilters('', { ...emptyAuditFilters, actor: 'u' })).toBe(true);
  });
});

describe('auditEntityRef', () => {
  it('links devices, subnets and IPs with their Site, and interfaces through their device', () => {
    expect(auditEntityRef({ entityType: 'Device', entityId: 'd1', metadata: { siteId: 's1', name: 'SW-01' } })).toEqual({ kind: 'device', id: 'd1', label: 'SW-01', siteId: 's1' });
    expect(auditEntityRef({ entityType: 'Subnet', entityId: 'n1', metadata: { cidr: '10.0.0.0/24' } })).toMatchObject({ kind: 'subnet', id: 'n1', label: '10.0.0.0/24' });
    expect(auditEntityRef({ entityType: 'IpAddress', entityId: 'ip1', metadata: { subnetId: 'n1', address: '10.0.0.5' } })).toMatchObject({ kind: 'ip', subnetId: 'n1', label: '10.0.0.5' });
    expect(auditEntityRef({ entityType: 'DeviceInterface', entityId: 'if1', metadata: { deviceId: 'd1' } })).toMatchObject({ kind: 'device', id: 'd1' });
  });

  it('returns no link for records without a page', () => {
    expect(auditEntityRef({ entityType: 'SystemSettings', entityId: 'x', metadata: null })).toBeNull();
    expect(auditEntityRef({ entityType: 'DeviceInterface', entityId: 'if1', metadata: {} })).toBeNull();
  });
});

describe('values', () => {
  it('formats empty, list and object values', () => {
    expect(formatAuditValue(null)).toBe('—');
    expect(formatAuditValue(['ADMIN', 'AUDITOR'])).toBe('ADMIN, AUDITOR');
    expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
    expect(formatAuditValue(30)).toBe('30');
  });

  it('hides before/after metadata keys only when a diff is shown', () => {
    const metadata = { previousDays: 90, nextDays: 30, reason: 'policy' };
    expect(metadataEntries(metadata, true)).toEqual([['reason', 'policy']]);
    expect(metadataEntries(metadata, false)).toHaveLength(3);
  });
});
