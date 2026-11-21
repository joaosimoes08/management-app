import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { DiscoveryJobStatus } from '@simoes/database';
import { enumWhere, parseEnumFilter } from './enum-filter';

test('parseEnumFilter accepts known values case-insensitively and rejects unknown ones with a 400', () => {
  assert.deepEqual(parseEnumFilter(undefined, DiscoveryJobStatus, 'status', 'X'), []);
  assert.deepEqual(parseEnumFilter(' running , completed,running', DiscoveryJobStatus, 'status', 'X'), ['RUNNING', 'COMPLETED']);
  assert.throws(() => parseEnumFilter('RUNNING,BOGUS', DiscoveryJobStatus, 'status', 'DISCOVERY_STATUS_INVALID'), (error: unknown) => error instanceof BadRequestException && (error.getResponse() as { code: string }).code === 'DISCOVERY_STATUS_INVALID');
  assert.equal(enumWhere([]), undefined);
  assert.equal(enumWhere(['A']), 'A');
  assert.deepEqual(enumWhere(['A', 'B']), { in: ['A', 'B'] });
});
