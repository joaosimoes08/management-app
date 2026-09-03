import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { SettingsService } from './settings.service';

const actor = { id: 'actor', externalId: 'kc-actor', username: 'admin', roles: ['ADMIN'] as const };
function createService() {
  let settings: any = { id: 'settings', organizationName: 'Org', organizationCode: 'ORG', timezone: 'Europe/Lisbon', locale: 'pt-PT', discoveryDefaultMethods: ['ICMP', 'TCP'], discoveryDefaultTcpPorts: [22, 80, 443, 3389], discoveryDefaultReverseDns: true, discoveryDefaultIntervalHours: 12, discoveryAllowedCidrs: ['10.0.0.0/8'], auditRetentionDays: 90, lastAuditCleanupAt: null, lastAuditCleanupDeletedCount: null };
  let listenerConfig: any = null;
  const listenerInterfaces = [
    { id: '10000000-0000-4000-8000-000000000001', instanceId: 'host:snmp-a', name: 'en0', address: '10.0.0.5', internal: false, lastSeenAt: new Date() },
    { id: '10000000-0000-4000-8000-000000000002', instanceId: 'host:snmp-b', name: 'eth0', address: '10.1.0.5', internal: false, lastSeenAt: new Date() },
  ];
  const prisma = {
    systemSettings: { findFirst: async () => settings, create: async () => settings, update: async ({ data }: any) => (settings = { ...settings, ...data }) }, site: { findMany: async () => [] }, auditLog: { count: async () => 0, findFirst: async () => null },
    snmpListenerConfig: { findUnique: async () => listenerConfig, upsert: async ({ create, update }: any) => (listenerConfig = { id: 'default', createdAt: new Date(), updatedAt: new Date(), ...(listenerConfig ? update : create) }) },
    snmpListenerInterface: { findMany: async ({ where }: any) => where?.id?.in ? listenerInterfaces.filter((item) => where.id.in.includes(item.id)) : listenerInterfaces },
  };
  const records: any[] = []; const audit = { record: async (entry: any) => { records.push(entry); } };
  return { service: new SettingsService(prisma as never, audit as never, {} as never), records, settings: () => settings };
}

test('organization settings persist the global locale', async () => {
  const fixture = createService(); const result = await fixture.service.updateOrganization({ locale: 'en-US' }, actor as never);
  assert.equal(result.locale, 'en-US'); assert.equal(fixture.records[0].action, 'ORGANIZATION_SETTINGS_UPDATED');
});

test('discovery defaults normalize duplicate ports and reject TCP without ports', async () => {
  const fixture = createService(); const result = await fixture.service.updateDiscovery({ methods: ['ICMP', 'TCP'], tcpPorts: [443, 22, 443], reverseDns: false, intervalHours: 24, allowedCidrs: ['10.0.0.0/8'] }, actor as never);
  assert.deepEqual(result.tcpPorts, [22, 443]); assert.equal(result.reverseDns, false); assert.equal(result.intervalHours, 24);
  await assert.rejects(() => fixture.service.updateDiscovery({ methods: ['TCP'], tcpPorts: [], reverseDns: true, intervalHours: 12, allowedCidrs: ['10.0.0.0/8'] }, actor as never), BadRequestException);
});

test('SNMP listener settings accept only reported interfaces and audit metadata', async () => {
  const fixture = createService();
  const result = await fixture.service.updateSnmpListeners({ listenAll: false, interfaceIds: ['10000000-0000-4000-8000-000000000001'] }, actor as never);
  assert.equal(result.listenAll, false);
  assert.deepEqual(result.selectedInterfaceIds, ['10000000-0000-4000-8000-000000000001']);
  assert.equal(fixture.records.at(-1).action, 'SNMP_LISTENERS_UPDATED');
  await assert.rejects(() => fixture.service.updateSnmpListeners({ listenAll: false, interfaceIds: [] }, actor as never), BadRequestException);
  await assert.rejects(() => fixture.service.updateSnmpListeners({ listenAll: false, interfaceIds: listenerIds }, actor as never), (error: BadRequestException) => (error.getResponse() as { code?: string }).code === 'SNMP_LISTENER_HOST_CONFLICT');
});

const listenerIds = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'];
