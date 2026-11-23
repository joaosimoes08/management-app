import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');
const narrowStart = styles.lastIndexOf('/* Narrow shell header (<= 780px)');
const narrowBlock = styles.slice(narrowStart);

describe('narrow shell header (<= 780px)', () => {
  it('is the last word on the shared header, after the unscoped desktop balance rules', () => {
    expect(narrowStart).toBeGreaterThan(styles.lastIndexOf('/* Final shared-shell balance'));
    expect(narrowStart).toBeGreaterThan(styles.lastIndexOf('/* Keep the site picker and global controls aligned'));
    expect(narrowBlock).toMatch(/^\/\*[\s\S]*?\*\/\s*@media \(max-width:780px\)/);
  });

  it('puts the module tabs on their own full-width row that does not clip the "Mais secções" menu', () => {
    expect(narrowBlock).toMatch(/\.app-shell > \.global-topbar \{[^}]*flex-wrap:wrap/);
    expect(narrowBlock).toMatch(/\.module-tabs-slot \{[^}]*order:5;[^}]*flex:1 1 100%;[^}]*overflow:visible/);
  });

  it('lets the site picker shrink and keeps search and bell compact on row 1', () => {
    expect(narrowBlock).toMatch(/\.global-site-switcher \{[^}]*flex:1 1 0;[^}]*min-width:0/);
    expect(narrowBlock).toMatch(/\.topbar-globals \{[^}]*flex:0 0 auto;[^}]*margin-left:0/);
    expect(narrowBlock).toMatch(/\.topbar-search-trigger \{[^}]*flex:0 0 40px;[^}]*width:40px/);
  });
});
