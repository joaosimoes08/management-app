import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

// Joao's decision (Step 28b): migrated critical devices become T1, so their review cadence does not change.
const sql = readFileSync(
  join(__dirname, '../../../../packages/database/prisma/migrations/20261122110000_critical_asset_tiers_cadence/migration.sql'),
  'utf8',
);

describe('critical asset tiers migration', () => {
  it('moves existing critical devices to T1, never T2', () => {
    assert.match(sql, /UPDATE "Device" SET "criticalityTier" = 'T1' WHERE "isCritical" = true;/);
    assert.doesNotMatch(sql, /criticalityTier" = 'T2'/);
  });
});
