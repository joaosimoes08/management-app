import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { LinuxAgentService, linuxAgentState } from './linux-agent.service';

{
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const agent = { id: 'agent-1', hostId: 'host-1', tokenHash: hash('valid'), revokedAt: null };
  const prisma: any = {
    linuxAgent: { findUnique: async () => agent, update: async () => ({}) },
    host: { update: async () => ({}) },
    $transaction: async (ops: any[]) => Promise.all(ops),
  };
  const service = new LinuxAgentService(prisma, { record: async () => undefined } as any, {} as any);

  test('accepts a valid enrolled token and updates only heartbeat identity fields', async () => {
    let hostUpdate: any;
    prisma.host.update = async (input: any) => { hostUpdate = input; return {}; };
    assert.deepEqual(await service.heartbeat('valid', { hostname: 'node-1', os: 'Linux', osVersion: '6.8', agentVersion: '1.0.0' }).then((value: any) => ({ accepted: value.accepted })), { accepted: true });
    assert.equal(hostUpdate.data.observedHostname, 'node-1');
    assert.equal(hostUpdate.data.operatingSystem, 'Linux 6.8');
    assert.equal(hostUpdate.data.observedStatus, 'ONLINE');
    assert.equal(hostUpdate.data.source, 'AGENT');
  });

  test('rejects unknown and revoked agents', async () => {
    prisma.linuxAgent.findUnique = async ({ where }: any) => where.tokenHash === hash('invalid') ? null : { ...agent, revokedAt: new Date() };
    await assert.rejects(() => service.heartbeat('invalid', { hostname: 'x', os: 'Linux', osVersion: '', agentVersion: '1' }), UnauthorizedException);
    await assert.rejects(() => service.heartbeat('valid', { hostname: 'x', os: 'Linux', osVersion: '', agentVersion: '1' }), UnauthorizedException);
  });

  test('computes current agent freshness independently of the Host last-observed status', () => {
    const now = Date.now();
    assert.equal(linuxAgentState(null, new Date(now - 5 * 60_000), now), 'STALE');
    assert.equal(linuxAgentState(null, null, now), 'PENDING');
    assert.equal(linuxAgentState(null, new Date(now - 60_000), now), 'ONLINE');
    assert.equal(linuxAgentState(new Date(now), new Date(now), now), 'REVOKED');
  });
}
