import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');

describe('SNMP action button styles', () => {
  it('uses one shared 160×35px size and lets toolbar actions fit narrow screens', () => {
    expect(styles).toMatch(/\.snmp-workspace \.snmp-action-button,\.app-shell \.context-toolbar-actions \.snmp-action-button\s*\{[\s\S]*?width:\s*160px;[\s\S]*?height:\s*35px;/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*780px\)\s*\{\s*\.app-shell \.context-toolbar-actions \.snmp-action-button\s*\{\s*width:\s*160px;\s*min-width:\s*0;/);
    expect(styles).toMatch(/@media\s*\(max-width:780px\)\s*\{\s*\.app-shell \.context-toolbar\s*\{[\s\S]*?flex-direction:\s*column;/);
  });
});
