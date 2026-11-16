import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');
const page = readFileSync(resolve(process.cwd(), 'features/ipam/ipam-page.tsx'), 'utf8');

describe('IPAM utility tabs', () => {
  it('centers tab labels and omits the redundant Map label from toolbar context', () => {
    expect(styles).toMatch(/\.app-shell \.global-topbar \.ipam-feature-tabs > button\s*\{[^}]*justify-content:\s*center;[^}]*text-align:\s*center;/);
    expect(page).toContain("tab === 'map' ? [] : [tabLabel]");
  });
});
