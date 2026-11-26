import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');

describe('Infrastructure topbar tabs', () => {
  it('let natural-width tabs grow to fill the whole navigation slot', () => {
    expect(styles).toMatch(/nav\.infrastructure-tabs\.natural-width-tabs > button\s*\{[^}]*flex:1 1 auto;[^}]*justify-content:center;/);
  });

  it('keeps other natural-width topbar menus (such as SNMP) at their own width', () => {
    expect(styles).toMatch(/nav\.infra-menu\.natural-width-tabs > button\s*\{[^}]*flex:0 1 auto;/);
  });
});
