import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { credentialTestResult } from './poll';

test('the credential test records the response time and the sysName it read', () => {
  assert.deepEqual(credentialTestResult([{ value: Buffer.from('c9300-core') }], 1_000, 1_142), { reachable: true, durationMs: 142, sysName: 'c9300-core' });
  assert.deepEqual(credentialTestResult([{ value: 'edge-1' }], 1_000, 1_005), { reachable: true, durationMs: 5, sysName: 'edge-1' });
});

test('the credential test never stores an empty or binary sysName', () => {
  assert.equal(credentialTestResult([], 1_000, 1_010).sysName, null);
  assert.equal(credentialTestResult([{ value: Buffer.from([0, 1, 2]) }], 1_000, 1_010).sysName, null);
  assert.equal(credentialTestResult([{ value: 'x' }], 2_000, 1_000).durationMs, 0);
});
