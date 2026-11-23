import { describe, expect, it } from 'vitest';
import { containerReceiverView, describeCredentialTest, iosXeSetupLines, latestJob, receiverAddresses, RECEIVER_PLACEHOLDER, type SnmpReceiverSettings } from './snmp-setup';

const iface = (id: string, address: string, internal = false) => ({ id, instanceId: 'i1', name: id, address, internal, lastSeenAt: '2026-11-23T10:00:00.000Z' });
const settings = (patch: Partial<SnmpReceiverSettings> = {}): SnmpReceiverSettings => ({ listenAll: true, selectedInterfaceIds: [], interfaces: [iface('eth0', '10.0.0.5'), iface('lo', '127.0.0.1', true), iface('ll', '169.254.1.2'), iface('v6', 'fe80::1'), iface('eth1', '10.0.1.5')], ...patch });

describe('receiverAddresses', () => {
  it('offers every non-internal IPv4 address when listening on all, never loopback, link-local or IPv6', () => {
    expect(receiverAddresses(settings())).toEqual(['10.0.0.5', '10.0.1.5']);
  });
  it('offers only the selected interfaces otherwise', () => {
    expect(receiverAddresses(settings({ listenAll: false, selectedInterfaceIds: ['eth1'] }))).toEqual(['10.0.1.5']);
    expect(receiverAddresses(undefined)).toEqual([]);
    expect(receiverAddresses({} as SnmpReceiverSettings)).toEqual([]);
  });
});

describe('iosXeSetupLines', () => {
  it('builds SNMPv3 authPriv lines with placeholders for every key and maps the protocols', () => {
    const lines = iosXeSetupLines({ receiver: '10.0.0.5', username: 'netops', authProtocol: 'SHA512', privProtocol: 'AES256' });
    expect(lines.v3).toContain('snmp-server user netops MGMT-APP v3 auth sha-2 512 <AUTH-KEY> priv aes 256 <PRIV-KEY> access MGMT-APP-SNMP');
    expect(lines.v3).toContain('snmp-server host 10.0.0.5 version 3 priv netops');
    expect(lines.v3).toContain('snmp-server trap-source <INTERFACE-DE-GESTAO>');
    expect(lines.v3).not.toMatch(/udp-port/);
    expect(lines.informs).toBeNull();
    expect(lines.v2c).toBeNull();
  });
  it('adds the UDP port when it is not 162, informs once the engine ID exists, and v2c lines when v2c is allowed', () => {
    const lines = iosXeSetupLines({ receiver: null, port: 1162, engineId: '800000090300AABBCCDDEEFF', v2cAllowed: true });
    expect(lines.v3).toContain(`snmp-server host ${RECEIVER_PLACEHOLDER} version 3 priv mgmt-app udp-port 1162`);
    expect(lines.informs).toContain(`snmp-server engineID remote ${RECEIVER_PLACEHOLDER} udp-port 1162 800000090300AABBCCDDEEFF`);
    expect(lines.v2c).toContain('snmp-server community <COMMUNITY> RO MGMT-APP-SNMP');
    expect(lines.v2c).toContain(`snmp-server host ${RECEIVER_PLACEHOLDER} version 2c <COMMUNITY> udp-port 1162`);
    expect(lines.v2c).toContain('snmp-server enable traps');
    expect(lines.v2c).toContain('snmp-server trap-source <INTERFACE-DE-GESTAO>');
    expect(lines.v2c).not.toMatch(/laborat/i);
  });
});

const job = (patch: Record<string, unknown>) => ({ id: 'j1', type: 'CREDENTIAL_TEST', status: 'COMPLETED', createdAt: '2026-11-23T10:00:00.000Z', ...patch });

describe('describeCredentialTest', () => {
  it('shows OK with the time and sysName', () => {
    expect(describeCredentialTest(job({ result: { reachable: true, durationMs: 42, sysName: 'core-sw-01' } }))).toEqual({ state: 'ok', label: 'OK', detail: '42 ms · sysName core-sw-01' });
  });
  it('tells timeout, authentication failure, other errors and running apart', () => {
    expect(describeCredentialTest(job({ status: 'FAILED', errorCode: 'SNMP_TIMEOUT', startedAt: '2026-11-23T10:00:00.000Z', completedAt: '2026-11-23T10:00:05.000Z' }))).toMatchObject({ state: 'timeout', label: 'Sem resposta (timeout)', detail: expect.stringContaining('5000 ms') });
    expect(describeCredentialTest(job({ status: 'FAILED', errorCode: 'SNMP_AUTHENTICATION_FAILED' }))).toMatchObject({ state: 'auth', label: 'Falha de autenticação' });
    expect(describeCredentialTest(job({ status: 'FAILED', errorCode: 'SNMP_EXECUTION_FAILED' }))).toMatchObject({ state: 'failed', detail: 'SNMP_EXECUTION_FAILED' });
    expect(describeCredentialTest(job({ status: 'RUNNING' }))).toEqual({ state: 'running', label: 'A testar…' });
  });
  it('picks the job a click started, else the newest of a type', () => {
    const jobs = [job({ id: 'a', createdAt: '2026-11-23T09:00:00.000Z' }), job({ id: 'b', createdAt: '2026-11-23T11:00:00.000Z' }), job({ id: 'c', type: 'POLL', createdAt: '2026-11-23T12:00:00.000Z' })];
    expect(latestJob(jobs, 'CREDENTIAL_TEST')?.id).toBe('b');
    expect(latestJob(jobs, 'CREDENTIAL_TEST', 'a')?.id).toBe('a');
    expect(latestJob(jobs, 'CREDENTIAL_TEST', 'zzz')).toBeNull();
  });
});

describe('containerReceiverView', () => {
  const container = (patch: Partial<NonNullable<SnmpReceiverSettings['containerReceiver']>>) => settings({ receiverMode: 'CONTAINER_INGRESS', containerReceiver: { address: null, addressSource: null, reason: null, port: 162, ...patch } });
  it('is null in host-agent mode and with an older API that sends no mode', () => {
    expect(containerReceiverView(settings({ receiverMode: 'HOST_AGENT', containerReceiver: null }))).toBeNull();
    expect(containerReceiverView(settings({}))).toBeNull();
    expect(containerReceiverView(null)).toBeNull();
  });
  it('shows address:port, bracketing IPv6 addresses', () => {
    expect(containerReceiverView(container({ address: '192.0.2.20', addressSource: 'SNMP_TRAP_PUBLIC_ADDRESS', port: 10162 }))).toMatchObject({ state: 'address', address: '192.0.2.20', display: '192.0.2.20:10162', port: 10162 });
    expect(containerReceiverView(container({ address: '10.1.1.5', addressSource: 'SNMP_TRAP_HOST_IP' }))).toMatchObject({ display: '10.1.1.5:162', source: 'SNMP_TRAP_HOST_IP' });
    expect(containerReceiverView(container({ address: '2001:db8::5' }))).toMatchObject({ display: '[2001:db8::5]:162' });
  });
  it('explains a missing or invalid SNMP_TRAP_PUBLIC_ADDRESS with distinct messages', () => {
    const required = containerReceiverView(container({ reason: 'SNMP_TRAP_PUBLIC_ADDRESS_REQUIRED' }));
    const invalid = containerReceiverView(container({ reason: 'SNMP_TRAP_PUBLIC_ADDRESS_INVALID' }));
    expect(required).toMatchObject({ state: 'missing', reason: 'REQUIRED' });
    expect(invalid).toMatchObject({ state: 'missing', reason: 'INVALID' });
    expect(required && 'message' in required && required.message).toMatch(/Define SNMP_TRAP_PUBLIC_ADDRESS no servidor/);
    expect(invalid && 'message' in invalid && invalid.message).toMatch(/não é um IP nem um nome DNS válido/);
    expect(containerReceiverView(container({ reason: null }))).toMatchObject({ reason: 'REQUIRED' });
  });
});
