import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(resolve(process.cwd(), 'features/audit/audit-page.tsx'), 'utf8');

describe('Audit utility actions', () => {
  it('places the filter disclosure in the trailing actions slot', () => {
    expect(page).toMatch(/actions=\{<>\s*<ToolbarMore label=\{tx\('audit\.filters'\)\}>/);
    expect(page).not.toMatch(/toolbar=\{<ToolbarMore label=\{tx\('audit\.filters'\)\}>/);
  });
});
