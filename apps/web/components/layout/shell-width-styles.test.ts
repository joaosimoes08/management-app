import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');
const start = styles.lastIndexOf('/* Shell width (fix/topbar-full-width)');
const block = styles.slice(start);

describe('shell width', () => {
  it('comes after the older 1600px page caps so it wins', () => {
    expect(start).toBeGreaterThan(styles.lastIndexOf('max-width:1600px'));
  });

  it('lets page workspaces fill the content area like the topbar and utility bar do', () => {
    expect(block).toMatch(/\.app-shell-content \.module-page,\s*\.app-shell-content \.aligned-workspace \{[^}]*max-width:none/);
  });

  it('right-aligns the global controls and lets search use the empty middle on pages without module tabs', () => {
    expect(block).toMatch(/\.global-topbar \.topbar-globals \{[^}]*justify-content:flex-end/);
    expect(block).toMatch(/:not\(:has\(\.module-tabs-slot nav\)\) \.module-tabs-slot \{[^}]*display:none/);
    expect(block).toMatch(/:not\(:has\(\.module-tabs-slot nav\)\) \.topbar-globals \{[^}]*flex:1 1 auto/);
  });
});
