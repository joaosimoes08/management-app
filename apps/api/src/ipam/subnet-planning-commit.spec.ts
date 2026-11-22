import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { IpamAdvancedService } from './ipam-advanced.service';
import { blockConflicts, collectAllocations, splitPreview, validateCommitBlocks } from './subnet-planning';

// ---------------------------------------------------------------------------
// Row 3 (split preview) and row 5 (named conflicts): pure functions.
// ---------------------------------------------------------------------------
const parent = { network: 10 * 2 ** 24, broadcast: 10 * 2 ** 24 + 255, cidr: '10.0.0.0/24' };
const sample = collectAllocations(parent, {
  addresses: [{ address: '10.0.0.1', state: 'OCCUPIED' }, { address: '10.0.0.2', state: 'OCCUPIED' }, { address: '10.0.0.70', state: 'RESERVED' }],
  subnets: [{ id: 'c1', cidr: '10.0.0.32/27', purpose: 'Servidores' }],
  gateway: '10.0.0.254',
});

test('row 3: split preview lists every aligned /27 with used/free counts and flags what occupies it', () => {
  const split = splitPreview('10.0.0.0/24', sample, 27, new Set(['10.0.0.96/27']));
  assert.equal(split.total, 8);
  assert.deepEqual(split.rows.map((row) => [row.cidr, row.used, row.free, row.available, row.planned]), [
    ['10.0.0.0/27', 2, 30, false, false],
    ['10.0.0.32/27', 32, 0, false, false],
    ['10.0.0.64/27', 1, 31, false, false],
    ['10.0.0.96/27', 0, 32, true, true],
    ['10.0.0.128/27', 0, 32, true, false],
    ['10.0.0.160/27', 0, 32, true, false],
    ['10.0.0.192/27', 0, 32, true, false],
    ['10.0.0.224/27', 1, 31, false, false],
  ]);
  assert.deepEqual(split.rows[0].conflicts.map((item) => item.label), ['Hosts 10.0.0.1 – 10.0.0.2 (2)']);
  assert.deepEqual(split.rows[1].conflicts.map((item) => [item.kind, item.label, item.subnetId]), [['SUBNET', 'Subnet 10.0.0.32/27 · Servidores', 'c1']]);
  assert.deepEqual(split.rows[2].conflicts.map((item) => item.label), ['Endereço reservado/excluído 10.0.0.70']);
  assert.deepEqual(split.rows[7].conflicts.map((item) => item.label), ['Gateway 10.0.0.254']);
});

test('row 3: split preview of a prefix shorter than the parent is empty; large splits are capped', () => {
  assert.deepEqual(splitPreview('10.0.0.0/24', sample, 23).rows, []);
  const big = splitPreview('10.0.0.0/16', [], 30);
  assert.equal(big.total, 16384);
  assert.equal(big.rows.length, 256);
  assert.equal(big.truncated, true);
});

test('row 5: conflicts name the overlapping child, hosts, reservation and gateway', () => {
  assert.deepEqual(blockConflicts(parent.network, parent.broadcast, sample).map((item) => item.label), [
    'Subnet 10.0.0.32/27 · Servidores',
    'Gateway 10.0.0.254',
    'Hosts 10.0.0.1 – 10.0.0.2 (2)',
    'Endereço reservado/excluído 10.0.0.70',
  ]);
  const hidden = collectAllocations(parent, { subnets: [{ id: 'x', cidr: '10.0.0.128/25', purpose: 'Privado', hidden: true }] });
  assert.deepEqual(blockConflicts(parent.network, parent.broadcast, hidden).map((item) => item.label), ['Subnet 10.0.0.128/25 (sem acesso)']);
});

test('row 4/5: commit validation rejects every kind of bad block with a reason', () => {
  const { accepted, problems } = validateCommitBlocks('10.0.0.0/24', sample, [
    { cidr: '10.0.0.96/27', purpose: ' LAN A ' },
    { cidr: 'nope' },
    { cidr: '10.0.0.100/27' },
    { cidr: '10.0.0.0/24' },
    { cidr: '10.0.1.0/27' },
    { cidr: '10.0.0.96/27' },
    { cidr: '10.0.0.96/28' },
    { cidr: '10.0.0.0/30' },
    { cidr: '10.0.0.128/27' },
  ], new Set(['10.0.0.128/27']));
  assert.deepEqual(accepted.map((block) => [block.cidr, block.purpose]), [['10.0.0.96/27', 'LAN A']]);
  assert.deepEqual(problems.map((item) => [item.cidr, item.reason]), [
    ['nope', 'INVALID_CIDR'],
    ['10.0.0.100/27', 'NOT_ALIGNED'],
    ['10.0.0.0/24', 'NOT_SMALLER_THAN_PARENT'],
    ['10.0.1.0/27', 'OUTSIDE_PARENT'],
    ['10.0.0.96/27', 'DUPLICATE_IN_REQUEST'],
    ['10.0.0.96/28', 'OVERLAPS_REQUEST'],
    ['10.0.0.0/30', 'OVERLAPS_EXISTING'],
    ['10.0.0.128/27', 'CIDR_EXISTS_ELSEWHERE'],
  ]);
  assert.equal(problems[6].message, '10.0.0.0/30 já não está livre: Hosts 10.0.0.1 – 10.0.0.2 (2).');
  assert.equal(problems[1].message, '10.0.0.100/27 não está alinhado: um /27 começa em 10.0.0.96.');
});

// ---------------------------------------------------------------------------
// Row 4: the commit endpoint. The service is built without its constructor
// (no Redis queue) and given an in-memory Prisma fake.
// ---------------------------------------------------------------------------
type Row = Record<string, any>;
function harness(options: { ips?: Row[]; subnets?: Row[]; failCreate?: string; denyCreate?: boolean; txError?: { code: string }; mutateBeforeCommit?: (state: { ips: Row[]; subnets: Row[] }) => void } = {}) {
  const parentRow = { id: 'p', cidr: '10.0.0.0/24', version: 4, siteId: 'site-1', vrfId: null, vlanId: null, gateway: '10.0.0.1', environment: 'prod', purpose: 'Produção', site: { name: 'LX' }, vrf: null, childSubnets: [] };
  const state = { ips: [...(options.ips ?? [])], subnets: [parentRow, ...(options.subnets ?? [])] as Row[] };
  const audits: Row[] = [];
  const created: Row[] = [];
  const placements: Row[] = [];
  let transactions = 0;
  const matches = (row: Row, where: Row): boolean => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return (value as Row[]).some((part) => matches(row, part));
    if (value && typeof value === 'object' && 'not' in value) return row[key] !== value.not;
    if (value && typeof value === 'object' && 'in' in value) return (value.in as unknown[]).includes(row[key]);
    return (row[key] ?? null) === value;
  });
  const db = {
    ipAddress: { findMany: async ({ where }: Row) => state.ips.filter((row) => matches(row, where)) },
    subnet: {
      findMany: async ({ where }: Row) => state.subnets.filter((row) => matches({ version: 4, ...row }, where)),
      findUnique: async ({ where }: Row) => state.subnets.find((row) => row.id === where.id) ?? null,
      create: async ({ data }: Row) => { if (options.failCreate === data.cidr) throw Object.assign(new Error('unique'), { code: 'P2002' }); const row = { id: `new-${created.length + 1}`, ...data }; created.push(row); return row; },
    },
    auditLog: { create: async ({ data }: Row) => { audits.push(data); return data; } },
  };
  const prisma = {
    ...db,
    subnet: { ...db.subnet, findUnique: async ({ where }: Row) => state.subnets.find((row) => row.id === where.id) ?? null },
    $transaction: async (work: (tx: unknown) => Promise<unknown>, txOptions: Row) => {
      transactions++;
      assert.equal(txOptions.isolationLevel, 'Serializable');
      if (options.txError) throw Object.assign(new Error('tx'), options.txError);
      options.mutateBeforeCommit?.(state);
      // Writes inside a failed transaction are rolled back: only keep them if work resolves.
      const before = { created: created.length, audits: audits.length };
      try { return await work(db); } catch (error) { created.length = before.created; audits.length = before.audits; throw error; }
    },
  };
  const access = {
    assertSubnet: async () => parentRow,
    assertContext: async () => undefined,
    assertSubnetPlacement: async (_user: unknown, action: string, placement: Row) => { placements.push({ action, ...placement }); if (options.denyCreate) throw new ForbiddenException({ code: 'IPAM_SCOPE_FORBIDDEN' }); return placement; },
  };
  const audit = { recordInTransaction: async (tx: any, input: Row) => tx.auditLog.create({ data: input }), scheduleInventoryQualityReconcile: async () => undefined };
  const service = Object.create(IpamAdvancedService.prototype) as IpamAdvancedService;
  Object.assign(service, { prisma, access, audit });
  return { service, state, audits, created, placements, get transactions() { return transactions; } };
}
const user = { id: 'u1', username: 'op', roles: ['NETWORK_OPERATOR'] } as any;

test('row 4: commit creates the confirmed children in one serializable transaction with audit entries', async () => {
  const h = harness({ ips: [{ subnetId: 'p', address: '10.0.0.5', state: 'OCCUPIED' }] });
  const result = await h.service.commitPlanning('p', [{ cidr: '10.0.0.64/27', purpose: 'LAN A' }, { cidr: '10.0.0.96/30' }], user);
  assert.equal(h.transactions, 1);
  assert.deepEqual(result.created.map((item) => item.cidr), ['10.0.0.64/27', '10.0.0.96/30']);
  assert.deepEqual(h.created.map((row) => [row.cidr, row.parentSubnetId, row.siteId, row.vrfId, row.environment, row.purpose, row.vlanId]), [
    ['10.0.0.64/27', 'p', 'site-1', null, 'prod', 'LAN A', undefined],
    ['10.0.0.96/30', 'p', 'site-1', null, 'prod', null, undefined],
  ]);
  assert.deepEqual(h.audits.map((entry) => entry.action), ['SUBNET_CREATED', 'SUBNET_CREATED', 'SUBNET_PLAN_COMMITTED']);
  assert.deepEqual(h.audits[2].metadata, { parentCidr: '10.0.0.0/24', created: ['10.0.0.64/27', '10.0.0.96/30'] });
  assert.deepEqual(h.placements, [{ action: 'CREATE', siteId: 'site-1', vrfId: null, parentSubnetId: 'p' }]);
});

test('row 4: commit rechecks availability and rejects, listing conflicts, when a host appeared after the preview', async () => {
  const h = harness({ mutateBeforeCommit: (state) => { state.ips.push({ subnetId: 'p', address: '10.0.0.70', state: 'OCCUPIED' }); state.subnets.push({ id: 'c9', cidr: '10.0.0.128/26', purpose: 'Nova', parentSubnetId: 'p', siteId: 'site-1', vrfId: null }); } });
  await assert.rejects(h.service.commitPlanning('p', [{ cidr: '10.0.0.64/27' }, { cidr: '10.0.0.128/27' }, { cidr: '10.0.0.224/27' }], user), (error: any) => {
    assert.ok(error instanceof ConflictException);
    const body: any = error.getResponse();
    assert.equal(body.code, 'PLANNING_CONFLICT');
    assert.deepEqual(body.conflicts.map((item: any) => [item.cidr, item.reason, item.conflicts.map((c: any) => c.label)]), [
      ['10.0.0.64/27', 'OVERLAPS_EXISTING', ['Host 10.0.0.70']],
      ['10.0.0.128/27', 'OVERLAPS_EXISTING', ['Subnet 10.0.0.128/26 · Nova']],
    ]);
    return true;
  });
  assert.equal(h.created.length, 0, 'nothing is created when any block conflicts');
  assert.equal(h.audits.length, 0);
});

test('row 4: commit rejects when the parent changed since the preview', async () => {
  const h = harness({ mutateBeforeCommit: (state) => { state.subnets[0] = { ...state.subnets[0], cidr: '10.0.0.0/25' }; } });
  await assert.rejects(h.service.commitPlanning('p', [{ cidr: '10.0.0.64/27' }], user), (error: any) => error.getResponse().code === 'PLANNING_PARENT_CHANGED');
  assert.equal(h.created.length, 0);
});

test('row 4: commit respects IPAM write permissions and writes nothing when CREATE is denied', async () => {
  const h = harness({ denyCreate: true });
  await assert.rejects(h.service.commitPlanning('p', [{ cidr: '10.0.0.64/27' }], user), ForbiddenException);
  assert.equal(h.transactions, 0);
  assert.equal(h.created.length, 0);
});

test('row 4: concurrent updates and unique races become friendly conflicts', async () => {
  await assert.rejects(harness({ txError: { code: 'P2034' } }).service.commitPlanning('p', [{ cidr: '10.0.0.64/27' }], user), (error: any) => error.getResponse().code === 'PLANNING_CONCURRENT_UPDATE');
  const race = harness({ failCreate: '10.0.0.96/27' });
  await assert.rejects(race.service.commitPlanning('p', [{ cidr: '10.0.0.64/27' }, { cidr: '10.0.0.96/27' }], user), (error: any) => error.getResponse().code === 'PLANNING_CONFLICT');
  assert.equal(race.created.length, 0, 'the first block is rolled back with the transaction');
});

test('row 4: commit validates the request size', async () => {
  const h = harness();
  await assert.rejects(h.service.commitPlanning('p', [], user), (error: any) => error.getResponse().code === 'INVALID_PLANNING_REQUEST');
  await assert.rejects(h.service.commitPlanning('p', Array.from({ length: 65 }, (_, i) => ({ cidr: `10.0.0.${i}/32` })), user), (error: any) => error.getResponse().code === 'INVALID_PLANNING_REQUEST');
});

test('row 1/7: the preview endpoint counts children, hosts and the gateway and returns the split', async () => {
  const h = harness({ ips: [{ subnetId: 'p', address: '10.0.0.5', state: 'OCCUPIED' }], subnets: [{ id: 'c1', cidr: '10.0.0.128/25', purpose: 'Voz', parentSubnetId: 'p', siteId: 'site-1', vrfId: null }] });
  (h.service as any).getSubnet = async () => h.state.subnets[0];
  const plan: any = await h.service.subnetPlanning('p', user, '26', '1');
  assert.deepEqual(plan.planned.map((block: any) => block.cidr), ['10.0.0.64/26']);
  assert.equal(plan.childSubnets, 1);
  assert.equal(plan.unavailable, 127 + 2);
  assert.deepEqual(plan.split.rows.map((row: any) => [row.cidr, row.used, row.planned]), [['10.0.0.0/26', 2, false], ['10.0.0.64/26', 0, true], ['10.0.0.128/26', 64, false], ['10.0.0.192/26', 64, false]]);
  assert.deepEqual(plan.scope, { vrfId: null, vrfName: null, siteId: 'site-1', siteName: 'LX' });
  assert.equal(h.created.length + h.audits.length, 0, 'the preview never writes');
});
