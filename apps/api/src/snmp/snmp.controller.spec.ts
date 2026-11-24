import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ROLES_KEY } from '../auth/roles.decorator';
import { parseForce, SnmpController } from './snmp.controller';

const roles = (method: keyof SnmpController) => Reflect.getMetadata(ROLES_KEY, SnmpController.prototype[method]);

describe('SNMP endpoint authorization policy', () => {
  it('limits credential, configuration, rotation and SET endpoints to ADMIN', () => {
    for (const method of ['unmatchedTraps', 'config', 'credential', 'deleteCredential', 'testCredential', 'previewWrite', 'executeWrite', 'rotate'] as const) {
      assert.deepEqual(roles(method), ['ADMIN']);
    }
  });

  it('allows scoped operators to poll/review and read roles to inspect', () => {
    assert.deepEqual(roles('poll'), ['ADMIN', 'NETWORK_OPERATOR']);
    assert.deepEqual(roles('reviewDrift'), ['ADMIN', 'NETWORK_OPERATOR']);
    assert.deepEqual(roles('overview'), ['ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY']);
    assert.deepEqual(roles('metrics'), ['ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY']);
    assert.deepEqual(roles('health'), ['ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY']);
    assert.deepEqual(roles('healthSummary'), ['ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY']);
  });

  it('step 9: health limits are written by ADMIN and NETWORK_OPERATOR and read by the usual read roles', () => {
    for (const method of ['updateSiteHealthThresholds', 'updateDeviceHealthThresholds'] as const) assert.deepEqual(roles(method), ['ADMIN', 'NETWORK_OPERATOR']);
    for (const method of ['healthThresholdDefaults', 'siteHealthThresholds', 'deviceHealthThresholds', 'healthHistory'] as const) assert.deepEqual(roles(method), ['ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY']);
  });

  it('D-P1d: discovery neighbour evidence is read-only and open to the read roles', () => {
    assert.deepEqual(roles('discoveryJobNeighbors'), ['ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY']);
    assert.deepEqual(roles('lldpObservations'), ['ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY']);
  });
});

describe('fix F2: credential delete force flag', () => {
  it('accepts only true/false and defaults to not forced', () => {
    assert.equal(parseForce(undefined), false);
    assert.equal(parseForce(''), false);
    assert.equal(parseForce('false'), false);
    assert.equal(parseForce('true'), true);
    for (const value of ['1', 'yes', 'TRUE']) assert.throws(() => parseForce(value), (error: { response?: { code?: string } }) => error.response?.code === 'SNMP_FORCE_INVALID');
  });
});
