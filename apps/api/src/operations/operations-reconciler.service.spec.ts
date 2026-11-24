import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import { CAPACITY_ALERT_SOURCE } from './capacity-alerts';
import { HEALTH_ALERT_SOURCE } from './health-alerts';
import { INTERFACE_ALERT_SOURCE } from './interface-alerts';
import { OperationsReconcilerService } from './operations-reconciler.service';

/** A database where every read returns nothing, except the models listed in `failing`, whose reads throw. */
function fakePrisma(failing: string[]) {
  const model = (name: string) => new Proxy({}, { get: () => async () => { if (failing.includes(name)) throw new Error(`${name} is down`); return []; } });
  return new Proxy({}, { get: (_target, prop: string) => (prop.startsWith('$') ? async () => [] : model(prop)) });
}

function harness(options: { failingModels?: string[]; failingSources?: string[] } = {}) {
  const reconciled: string[] = [];
  const warnings: string[] = [];
  const service = Object.create(OperationsReconcilerService.prototype) as any;
  service.prisma = fakePrisma(options.failingModels ?? []);
  service.queue = { getJobCounts: async () => ({}) };
  service.logger = { warn: (message: string) => warnings.push(message) } as unknown as Logger;
  service.running = false;
  service.interfaceAlertsAt = 0; service.healthAlertsAt = 0; service.lastCapacityAt = 0;
  service.operations = {
    reopenExpiredSnoozes: async () => undefined,
    reconcileSource: async (source: string) => { if ((options.failingSources ?? []).includes(source)) throw new Error(`${source} upsert failed`); reconciled.push(source); },
  };
  return { service, reconciled, warnings };
}

describe('Operations reconciler: a failing alert stage never stops the later ones', () => {
  it('runs every stage when nothing fails', async () => {
    const { service, reconciled, warnings } = harness();
    await service.reconcile();
    assert.deepEqual(reconciled.slice(-3), [INTERFACE_ALERT_SOURCE, HEALTH_ALERT_SOURCE, CAPACITY_ALERT_SOURCE]);
    assert.deepEqual(warnings, []);
  });

  it('a throwing health read is logged and capacity still runs', async () => {
    const { service, reconciled, warnings } = harness({ failingModels: ['snmpDeviceHealth'] });
    await service.reconcile();
    assert.ok(!reconciled.includes(HEALTH_ALERT_SOURCE));
    assert.ok(reconciled.includes(INTERFACE_ALERT_SOURCE));
    assert.ok(reconciled.includes(CAPACITY_ALERT_SOURCE), 'capacity runs after a failed health stage');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /SNMP_HEALTH failed.*snmpDeviceHealth is down/);
    assert.equal(service.running, false, 'the next tick can run');
  });

  it('a throwing health upsert is isolated the same way', async () => {
    const { service, reconciled, warnings } = harness({ failingSources: [HEALTH_ALERT_SOURCE] });
    await service.reconcile();
    assert.ok(reconciled.includes(CAPACITY_ALERT_SOURCE));
    assert.match(warnings[0], /SNMP_HEALTH failed/);
  });

  it('interface and capacity stages are isolated too', async () => {
    const { service, reconciled, warnings } = harness({ failingSources: [INTERFACE_ALERT_SOURCE, CAPACITY_ALERT_SOURCE] });
    await service.reconcile();
    assert.ok(reconciled.includes(HEALTH_ALERT_SOURCE), 'health runs after a failed interface stage');
    assert.deepEqual(warnings.map((item) => item.match(/stage (\S+) failed/)?.[1]), [INTERFACE_ALERT_SOURCE, CAPACITY_ALERT_SOURCE]);
  });

  it('a failed stage waits for its next interval instead of retrying every tick', async () => {
    const { service, warnings } = harness({ failingModels: ['snmpDeviceHealth'] });
    await service.reconcile();
    await service.reconcile();
    assert.equal(warnings.length, 1);
  });

  it('a failed pass is logged by the timer tick instead of being swallowed', async () => {
    const { service, warnings } = harness();
    service.operations.reopenExpiredSnoozes = async () => { throw new Error('db gone'); };
    await service.tick();
    assert.match(warnings[0], /Reconciliation pass failed: db gone/);
    assert.equal(service.running, false);
  });
});
