import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { ChangePlansService } from './change-plans.service';

const at = (h: number) => new Date(Date.UTC(2026, 10, 21, h));
const operator = { id: 'u1', roles: ['NETWORK_OPERATOR'] } as any;

/** A service over an in-memory plan, with access checks stubbed to "allowed". */
function harness(initial: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const plan: any = { id: 'p1', siteId: 's1', title: 'T', reason: 'R', revision: 2, plannedStartAt: at(10), plannedEndAt: at(12), items: [{ entityType: 'VLAN', entityId: 'v1', operationSummary: 'Renomear', currentValue: { name: 'old' }, proposedValue: { name: 'Servers' } }], ...initial };
  const audits: any[] = [];
  const service = Object.create(ChangePlansService.prototype) as any;
  service.audit = { record: async (entry: any) => { audits.push(entry); } };
  service.assertSite = async () => undefined;
  service.readableTargetKeys = async (_u: unknown, _s: unknown, targets: any[]) => new Set(targets.map((t) => `${t.entityType}:${t.entityId}`));
  service.get = async () => ({ ...plan });
  service.prisma = {
    changePlan: {
      findUnique: async () => ({ ...plan }),
      findMany: async () => [],
      updateMany: async ({ where, data }: any) => { if (where.status !== plan.status || (where.revision && where.revision !== plan.revision)) return { count: 0 }; Object.assign(plan, data); return { count: 1 }; },
    },
    changePlanChecklistItem: { findMany: async () => [{ doneAt: at(11) }, { doneAt: null }] },
    maintenanceWindow: { findMany: async () => [{ startsAt: at(9), endsAt: at(11) }] },
    vlan: { findMany: async () => [{ id: 'v1', name: 'Servers', vlanId: 24 }] },
    deviceInterface: { findMany: async () => [] },
    device: { findMany: async () => [] },
    ...extra,
  };
  return { service, plan, audits };
}

describe('change plan execution (Step 30)', () => {
  it('starts only an APPROVED plan, records who/when and audits it with warnings', async () => {
    const { service, plan, audits } = harness({ status: 'APPROVED' });
    const result = await service.start(operator, 'p1', { note: 'A começar' });
    assert.equal(plan.status, 'IN_PROGRESS'); assert.equal(plan.startedById, 'u1'); assert.ok(plan.startedAt instanceof Date);
    assert.equal(audits[0].action, 'CHANGE_PLAN_STARTED'); assert.equal(audits[0].metadata.note, 'A começar');
    // 11:00–12:00 is outside the only maintenance window (09:00–11:00).
    assert.deepEqual(result.warnings.map((w: any) => w.code), ['OUTSIDE_MAINTENANCE_WINDOW']);
    assert.deepEqual(audits[0].metadata.warningCodes, ['OUTSIDE_MAINTENANCE_WINDOW']);
  });

  it('refuses to start a plan that is not APPROVED and audits nothing', async () => {
    for (const status of ['DRAFT', 'SUBMITTED', 'IN_PROGRESS', 'COMPLETED']) {
      const { service, audits } = harness({ status });
      await assert.rejects(service.start(operator, 'p1', {}), (error: any) => error instanceof ConflictException && (error.getResponse() as any).code === 'CHANGE_PLAN_NOT_STARTABLE');
      assert.equal(audits.length, 0);
    }
  });

  it('closes only an IN_PROGRESS plan with a closing note, audits the outcome and the post-change check', async () => {
    const { service, plan, audits } = harness({ status: 'IN_PROGRESS' });
    const result = await service.close(operator, 'p1', { status: 'ROLLED_BACK', closingNote: 'Reverti' });
    assert.equal(plan.status, 'ROLLED_BACK'); assert.equal(plan.closedById, 'u1'); assert.equal(plan.closingNote, 'Reverti');
    assert.equal(audits[0].action, 'CHANGE_PLAN_ROLLED_BACK'); assert.equal(audits[0].metadata.note, 'Reverti');
    assert.equal(audits[0].metadata.checklistDone, 1); assert.equal(audits[0].metadata.checklistTotal, 2);
    assert.equal(result.postChangeCheck.result, 'AS_PLANNED');
    const { service: s2 } = harness({ status: 'APPROVED' });
    await assert.rejects(s2.close(operator, 'p1', { status: 'COMPLETED' }), (error: any) => (error.getResponse() as any).code === 'CHANGE_PLAN_NOT_CLOSABLE');
    const { service: s3 } = harness({ status: 'IN_PROGRESS' });
    await assert.rejects(s3.close(operator, 'p1', { status: 'FAILED' }), (error: any) => (error.getResponse() as any).code === 'CHANGE_CLOSING_NOTE_REQUIRED');
  });

  it('post-change check flags a deliberately changed field', async () => {
    const { service } = harness({ status: 'IN_PROGRESS' }, { vlan: { findMany: async () => [{ id: 'v1', name: 'Changed-by-hand', vlanId: 24 }] } });
    const check = await service.postChangeCheck(operator, 'p1');
    assert.equal(check.result, 'DIFFERENT');
    assert.deepEqual(check.items[0].fields[0], { field: 'name', planned: 'Servers', current: 'Changed-by-hand', before: 'old', matches: false });
  });

  it('read-only users cannot start or close', async () => {
    const { service } = harness({ status: 'APPROVED' });
    await assert.rejects(service.start({ id: 'r', roles: ['READ_ONLY'] }, 'p1', {}));
  });
});
