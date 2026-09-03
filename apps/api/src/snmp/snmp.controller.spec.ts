import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ROLES_KEY } from '../auth/roles.decorator';
import { SnmpController } from './snmp.controller';

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
  });
});
