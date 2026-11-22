import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { BadRequestException, ForbiddenException, ValidationPipe, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/roles.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { APPLICATION_ROLES } from '../auth/roles';
import { CommitSubnetPlanDto } from './dto';
import { IpamController } from './ipam.controller';

// POST /api/v1/subnets/:id/planning/commit: the body DTO with the app's global ValidationPipe options, and the role guard.
const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true, validationError: { target: false, value: false } });
const validate = (body: unknown) => pipe.transform(body, { type: 'body', metatype: CommitSubnetPlanDto });
const rejects400 = (body: unknown) => assert.rejects(validate(body), BadRequestException, JSON.stringify(body).slice(0, 80));

describe('POST subnets/:id/planning/commit body', () => {
  it('accepts up to 64 well-formed blocks', async () => {
    const ok = await validate({ blocks: [{ cidr: '10.0.0.64/27', purpose: 'LAN A' }, { cidr: '10.0.0.96/30' }] });
    assert.ok(ok instanceof CommitSubnetPlanDto);
    await validate({ blocks: Array.from({ length: 64 }, (_, i) => ({ cidr: `10.0.${i}.0/24` })) });
  });

  it('returns 400 for more than 64 blocks', async () => {
    await rejects400({ blocks: Array.from({ length: 65 }, (_, i) => ({ cidr: `10.0.${i}.0/24` })) });
  });

  it('returns 400 for malformed blocks', async () => {
    for (const body of [
      {},
      { blocks: [] },
      { blocks: 'all' },
      { blocks: [{}] },
      { blocks: [{ cidr: 42 }] },
      { blocks: [{ cidr: '1.2/3' }] },
      { blocks: [{ cidr: 'not-a-cidr!' }] },
      { blocks: [{ cidr: '2001:db8::/64' }] },
      { blocks: [{ cidr: '10.0.0.0/24'.padEnd(19, '0') }] },
      { blocks: [{ cidr: '10.0.0.0/24', purpose: 'x'.repeat(101) }] },
      { blocks: [{ cidr: '10.0.0.0/24', vrfId: 'other' }] },
      { blocks: [{ cidr: '10.0.0.0/24' }], siteId: 'other' },
    ]) await rejects400(body);
  });
});

describe('POST subnets/:id/planning/commit roles', () => {
  const handler = IpamController.prototype.commitSubnetPlanning;
  const guard = new RolesGuard(new Reflector());
  const context = (roles: string[]) => ({ getHandler: () => handler, getClass: () => IpamController, switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u', roles } }) }) }) as unknown as ExecutionContext;

  it('is limited to ADMIN and NETWORK_OPERATOR', () => {
    assert.deepEqual(Reflect.getMetadata(ROLES_KEY, handler), ['ADMIN', 'NETWORK_OPERATOR']);
    assert.equal(guard.canActivate(context(['ADMIN'])), true);
    assert.equal(guard.canActivate(context(['NETWORK_OPERATOR'])), true);
  });

  it('returns 403 for every other role and for no role', () => {
    for (const role of APPLICATION_ROLES.filter((item) => item !== 'ADMIN' && item !== 'NETWORK_OPERATOR')) {
      assert.throws(() => guard.canActivate(context([role])), (error: unknown) => error instanceof ForbiddenException && error.getStatus() === 403, role);
    }
    assert.throws(() => guard.canActivate(context([])), ForbiddenException);
  });
});
