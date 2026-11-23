import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { credentialTestDeadlineMs, expiredCredentialTests, SNMP_WORKER_UNAVAILABLE } from './credential-test-deadline';

const at = (iso: string) => new Date(iso);
const job = (patch: Record<string, unknown>) => ({ id: 'j', type: 'CREDENTIAL_TEST', status: 'PENDING', createdAt: at('2026-11-23T10:00:00Z'), startedAt: null, ...patch }) as any;

test('the deadline is the device timeout plus the grace period (default timeout 5 s)', () => {
  assert.equal(credentialTestDeadlineMs(null), 15_000);
  assert.equal(credentialTestDeadlineMs({ timeoutMs: 2_000 }), 12_000);
});

test('a test no worker picked up is closed as SNMP_WORKER_UNAVAILABLE after the deadline, not before', () => {
  assert.deepEqual(expiredCredentialTests([job({})], null, at('2026-11-23T10:00:14Z')), []);
  assert.deepEqual(expiredCredentialTests([job({})], null, at('2026-11-23T10:00:16Z')), [{ id: 'j', status: 'PENDING', errorCode: SNMP_WORKER_UNAVAILABLE }]);
});

test('a test stuck RUNNING is closed as SNMP_TIMEOUT, counted from when it started', () => {
  const running = job({ status: 'RUNNING', startedAt: at('2026-11-23T10:00:10Z') });
  assert.deepEqual(expiredCredentialTests([running], { timeoutMs: 5_000 }, at('2026-11-23T10:00:20Z')), []);
  assert.deepEqual(expiredCredentialTests([running], { timeoutMs: 5_000 }, at('2026-11-23T10:00:26Z')), [{ id: 'j', status: 'RUNNING', errorCode: 'SNMP_TIMEOUT' }]);
});

test('finished tests and other job types are left alone', () => {
  const late = at('2026-11-23T12:00:00Z');
  assert.deepEqual(expiredCredentialTests([job({ status: 'COMPLETED' }), job({ status: 'FAILED' }), job({ type: 'POLL' })], null, late), []);
});
