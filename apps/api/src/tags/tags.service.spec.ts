import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TagsService } from './tags.service';
import { normalizeTagColor, normalizeTagIds, normalizeTagName, parseTagFilter, withFlatTags } from './tag-rules';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const SITE_B = '22222222-2222-4222-8222-222222222222';
const TAG_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TAG_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TAG_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEVICE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SUBNET = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const user = { id: 'user-1', roles: ['SYSTEMS_OPERATOR'] } as any;

describe('tag rules', () => {
  it('normalises names and rejects empty or long ones', () => {
    assert.equal(normalizeTagName('  core   network '), 'core network');
    assert.throws(() => normalizeTagName('   '), BadRequestException);
    assert.throws(() => normalizeTagName('x'.repeat(41)), BadRequestException);
  });
  it('accepts only design-system colours, defaulting to gray', () => {
    assert.equal(normalizeTagColor(undefined), 'gray');
    assert.equal(normalizeTagColor('amber'), 'amber');
    assert.throws(() => normalizeTagColor('#ff0000'), BadRequestException);
  });
  it('dedupes tag ids and caps them at 20', () => {
    assert.deepEqual(normalizeTagIds([TAG_1, TAG_1.toUpperCase(), TAG_2]), [TAG_1, TAG_2]);
    assert.deepEqual(normalizeTagIds([]), []);
    assert.throws(() => normalizeTagIds(['nope']), BadRequestException);
    assert.throws(() => normalizeTagIds('x'), BadRequestException);
    const many = Array.from({ length: 21 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`);
    assert.throws(() => normalizeTagIds(many), BadRequestException);
  });
  it('parses the list filter: empty is no filter, ids are AND-ed, junk is a 400', () => {
    assert.deepEqual(parseTagFilter(undefined), []);
    assert.deepEqual(parseTagFilter(''), []);
    assert.deepEqual(parseTagFilter(`${TAG_1}, ${TAG_2},${TAG_1}`), [TAG_1, TAG_2]);
    assert.throws(() => parseTagFilter('core'), BadRequestException);
    assert.throws(() => parseTagFilter(','), BadRequestException);
  });
  it('flattens join rows into tags sorted by name', () => {
    const item = withFlatTags({ id: 'x', tags: [{ tag: { id: TAG_2, name: 'zeta', color: 'gray' } }, { tag: { id: TAG_1, name: 'Alfa', color: 'blue' } }] });
    assert.deepEqual(item.tags.map((tag) => tag.name), ['Alfa', 'zeta']);
    assert.deepEqual(withFlatTags({ id: 'y' } as { id: string; tags?: [] }).tags, []);
  });
});

type Fixture = { infraAllows?: Record<string, boolean>; ipamAllows?: Record<string, boolean>; deviceSite?: string | null; subnetSite?: string | null; currentDeviceTags?: string[]; nameClash?: boolean };

function setup(fixture: Fixture = {}) {
  const audits: any[] = [];
  const writes: any[] = [];
  const tags = [
    { id: TAG_1, siteId: SITE_A, name: 'core', color: 'blue' },
    { id: TAG_2, siteId: SITE_A, name: 'dmz', color: 'red' },
    { id: TAG_B, siteId: SITE_B, name: 'lab', color: 'gray' },
  ];
  const deviceTags = new Set(fixture.currentDeviceTags ?? []);
  const tx = {
    deviceTag: { deleteMany: async (args: any) => { writes.push(['deviceTag.deleteMany', args]); args.where.tagId.in.forEach((id: string) => deviceTags.delete(id)); }, createMany: async (args: any) => { writes.push(['deviceTag.createMany', args]); args.data.forEach((row: any) => deviceTags.add(row.tagId)); } },
    subnetTag: { deleteMany: async (args: any) => writes.push(['subnetTag.deleteMany', args]), createMany: async (args: any) => writes.push(['subnetTag.createMany', args]) },
  };
  const prisma: any = {
    tag: {
      findMany: async ({ where }: any) => where.id ? tags.filter((tag) => where.id.in.includes(tag.id)) : tags.filter((tag) => tag.siteId === where.siteId).map((tag) => ({ ...tag, _count: { devices: 1, subnets: 0 } })),
      findFirst: async () => fixture.nameClash ? { id: 'other' } : null,
      findUnique: async ({ where }: any) => tags.find((tag) => tag.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: any) => ({ ...tags.find((tag) => tag.id === where.id)!, _count: { devices: 2, subnets: 1 } }),
      create: async ({ data }: any) => { writes.push(['tag.create', data]); return { id: 'new-tag', ...data }; },
      update: async (args: any) => { writes.push(['tag.update', args]); return args.data; },
      delete: async (args: any) => { writes.push(['tag.delete', args]); },
    },
    device: { findUnique: async () => ({ rack: null }) },
    deviceTag: { findMany: async () => [...deviceTags].map((tagId) => ({ tagId, tag: { name: tags.find((tag) => tag.id === tagId)!.name } })), count: async () => 3 },
    subnetTag: { findMany: async () => [], count: async () => 1 },
    $transaction: async (callback: (client: any) => Promise<unknown>) => callback(tx),
  };
  const audit: any = { record: async (entry: any) => audits.push(entry), recordInTransaction: async (_tx: any, entry: any) => audits.push(entry) };
  const denied = (action: string) => action === 'READ' ? new NotFoundException('hidden') : new ForbiddenException('no');
  const infrastructure: any = {
    assertSite: async (_user: any, action: string) => { if (!(fixture.infraAllows ?? { READ: true, UPDATE: true })[action]) throw denied(action); return {}; },
    assertDevice: async (_user: any, action: string) => { if (!(fixture.infraAllows ?? { READ: true, UPDATE: true })[action]) throw denied(action); return { id: DEVICE, siteId: fixture.deviceSite === undefined ? SITE_A : fixture.deviceSite }; },
  };
  const ipam: any = {
    assertSite: async (_user: any, action: string) => { if (!(fixture.ipamAllows ?? {})[action]) throw denied(action); return {}; },
    assertSubnet: async (_user: any, action: string) => { if (!(fixture.ipamAllows ?? { READ: true, UPDATE: true })[action]) throw denied(action); return { id: SUBNET, siteId: fixture.subnetSite === undefined ? SITE_A : fixture.subnetSite }; },
  };
  return { service: new TagsService(prisma, audit, infrastructure, ipam), audits, writes, deviceTags };
}

describe('TagsService', () => {
  it('lists the Site catalog with usage counts', async () => {
    const { service } = setup();
    const list = await service.list(user, SITE_A);
    assert.deepEqual(list.map((tag) => [tag.name, tag.deviceCount, tag.subnetCount]), [['core', 1, 0], ['dmz', 1, 0]]);
    await assert.rejects(service.list(user, undefined), BadRequestException);
  });

  it('falls back to the IPAM scope when the infrastructure scope does not allow it', async () => {
    const { service } = setup({ infraAllows: {}, ipamAllows: { READ: true } });
    assert.equal((await service.list(user, SITE_A)).length, 2);
    const blocked = setup({ infraAllows: {}, ipamAllows: {} });
    await assert.rejects(blocked.service.list(user, SITE_A), NotFoundException);
  });

  it('creates a tag, audited, and refuses a duplicate name in the Site', async () => {
    const { service, audits } = setup();
    const tag = await service.create(user, { siteId: SITE_A, name: ' Backup ', color: 'green' });
    assert.equal(tag.name, 'Backup');
    assert.equal(audits[0].action, 'TAG_CREATED');
    await assert.rejects(setup({ nameClash: true }).service.create(user, { siteId: SITE_A, name: 'CORE' }), ConflictException);
  });

  it('read-only scope cannot change the catalog', async () => {
    const { service, writes } = setup({ infraAllows: { READ: true }, ipamAllows: { READ: true } });
    await assert.rejects(service.create(user, { siteId: SITE_A, name: 'x' }), ForbiddenException);
    await assert.rejects(service.remove(user, TAG_1), ForbiddenException);
    assert.equal(writes.length, 0);
  });

  it('renames with before/after in the audit, and skips a no-op', async () => {
    const { service, audits } = setup();
    await service.update(user, TAG_1, { name: 'core-net' });
    assert.deepEqual(audits[0].metadata.before, { name: 'core', color: 'blue' });
    assert.deepEqual(audits[0].metadata.after, { name: 'core-net', color: 'blue' });
    await service.update(user, TAG_1, { name: 'core', color: 'blue' });
    assert.equal(audits.length, 1);
    await assert.rejects(service.update(user, 'not-a-uuid', { name: 'x' }), NotFoundException);
  });

  it('deleting a tag records how many items lost it', async () => {
    const { service, audits } = setup();
    await service.remove(user, TAG_1);
    assert.equal(audits[0].action, 'TAG_DELETED');
    assert.equal(audits[0].metadata.removedFromDevices, 3);
    assert.equal(audits[0].metadata.removedFromSubnets, 1);
  });

  it('replaces device tags, auditing only what was added and removed', async () => {
    const { service, audits, deviceTags } = setup({ currentDeviceTags: [TAG_1] });
    const result = await service.setDeviceTags(user, DEVICE, [TAG_2]);
    assert.deepEqual(result.tags.map((tag) => tag.name), ['dmz']);
    assert.deepEqual([...deviceTags], [TAG_2]);
    assert.deepEqual(audits[0], { userId: 'user-1', action: 'DEVICE_TAGS_UPDATED', entityType: 'Device', entityId: DEVICE, metadata: { siteId: SITE_A, added: ['dmz'], removed: ['core'] } });
    await service.setDeviceTags(user, DEVICE, [TAG_2]);
    assert.equal(audits.length, 1, 'an unchanged set writes no audit entry');
  });

  it('refuses tags from another Site, unknown tags and devices without a Site', async () => {
    await assert.rejects(setup().service.setDeviceTags(user, DEVICE, [TAG_B]), (error: any) => error.getResponse().code === 'TAG_SITE_MISMATCH');
    await assert.rejects(setup().service.setDeviceTags(user, DEVICE, ['99999999-9999-4999-8999-999999999999']), (error: any) => error.getResponse().code === 'TAG_NOT_FOUND');
    await assert.rejects(setup({ deviceSite: null }).service.setDeviceTags(user, DEVICE, [TAG_1]), (error: any) => error.getResponse().code === 'TAG_DEVICE_WITHOUT_SITE');
  });

  it('device tag changes need UPDATE on the device', async () => {
    const { service, writes } = setup({ infraAllows: { READ: true } });
    await assert.rejects(service.setDeviceTags(user, DEVICE, [TAG_1]), ForbiddenException);
    assert.equal(writes.length, 0);
  });

  it('sets subnet tags through the IPAM scope', async () => {
    const { service, audits } = setup();
    const result = await service.setSubnetTags(user, SUBNET, [TAG_1, TAG_2]);
    assert.deepEqual(result.tags.map((tag) => tag.name), ['core', 'dmz']);
    assert.equal(audits[0].action, 'SUBNET_TAGS_UPDATED');
    await assert.rejects(setup({ ipamAllows: { READ: true } }).service.setSubnetTags(user, SUBNET, [TAG_1]), ForbiddenException);
    await assert.rejects(setup({ subnetSite: null }).service.setSubnetTags(user, SUBNET, [TAG_1]), BadRequestException);
  });
});
