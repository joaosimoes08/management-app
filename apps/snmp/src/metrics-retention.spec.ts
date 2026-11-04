import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { metricsRetentionDays } from './metrics-retention';

describe('SNMP metrics retention configuration', () => {
  it('defaults to 90 days and accepts bounded whole-day values', () => {
    assert.equal(metricsRetentionDays(undefined), 90);
    assert.equal(metricsRetentionDays('30'), 30);
    assert.equal(metricsRetentionDays('3650'), 3650);
  });
  it('rejects non-integer and out-of-range values', () => {
    for (const value of ['0', '-1', '2.5', '3651', 'abc']) assert.throws(() => metricsRetentionDays(value));
  });
});
