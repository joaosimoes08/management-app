import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('leftover section kickers', () => {
  it.each([
    'components/layout/site-switcher.tsx',
    'features/infrastructure/components/infrastructure-permissions.tsx',
    'features/infrastructure/components/rack/rack-detail.tsx',
    'features/ipam/components/central-permissions.tsx',
    'features/ipam/components/subnet-capacity-trend.tsx',
  ])('%s renders no section kicker', (path) => {
    expect(read(path)).not.toContain('section-kicker');
  });
});
