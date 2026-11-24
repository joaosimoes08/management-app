import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { HEALTH_HISTORY_MAX_ROWS, SnmpHealthThresholdsService } from './snmp-health-thresholds.service';

describe('SNMP health history', () => {
  it('returns the newest rows when the window holds more than the cap, oldest first', async () => {
    const stored = Array.from({ length: HEALTH_HISTORY_MAX_ROWS + 5 }, (_, index) => ({ observedAt: new Date(Date.UTC(2026, 10, 1) + index * 300_000) }));
    let query: { orderBy?: { observedAt: string }; take?: number } = {};
    const prisma = {
      device: { findUnique: async () => ({ id: 'd1', type: 'SWITCH', siteId: 's1' }) },
      snmpDeviceHealthSample: {
        findMany: async (args: typeof query) => {
          query = args;
          const sorted = [...stored].sort((a, b) => (args.orderBy?.observedAt === 'desc' ? -1 : 1) * (a.observedAt.getTime() - b.observedAt.getTime()));
          return sorted.slice(0, args.take);
        },
      },
    };
    const access = { assertDevice: async () => undefined };
    const service = new SnmpHealthThresholdsService(prisma as never, {} as never, access as never);
    const result = await service.history({} as never, 'd1', '720');
    assert.equal(query.orderBy?.observedAt, 'desc');
    assert.equal(query.take, HEALTH_HISTORY_MAX_ROWS);
    assert.equal(result.items.length, HEALTH_HISTORY_MAX_ROWS);
    assert.deepEqual(result.items[0], stored[5], 'the oldest five rows are the ones dropped');
    assert.deepEqual(result.items.at(-1), stored.at(-1), 'the newest row is kept');
    for (let index = 1; index < result.items.length; index += 1) assert.ok(result.items[index - 1].observedAt < result.items[index].observedAt);
  });
});
