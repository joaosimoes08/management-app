import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AccessPolicyService } from './access-policy.service';

const policy = new AccessPolicyService();
const user = (roles: string[]) => ({ id: 'user', externalId: 'external', username: 'user', roles }) as never;

test('role capabilities do not inherit write access from read-only roles', () => {
  assert.equal(policy.canManagePhysical(user(['READ_ONLY']), 'READ'), true);
  assert.equal(policy.canManagePhysical(user(['READ_ONLY']), 'CREATE'), false);
  assert.equal(policy.canUseIpam(user(['AUDITOR']), 'READ'), true);
  assert.equal(policy.canUseIpam(user(['AUDITOR']), 'IMPORT'), false);
});

test('admin bypasses every role capability', () => {
  assert.equal(policy.canManagePhysical(user(['ADMIN']), 'DELETE'), true);
  assert.equal(policy.canManageDevice(user(['ADMIN']), 'UPDATE', 'OTHER'), true);
  assert.equal(policy.canUseIpam(user(['ADMIN']), 'DISCOVER'), true);
});
