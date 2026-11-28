import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateMessage } from '@/lib/i18n/i18n';

const styles = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');

describe('SNMP action button styles', () => {
  it('uses functional headings without section eyebrows', () => {
    const source = readFileSync(resolve(process.cwd(), 'features/snmp/snmp-page.tsx'), 'utf8');
    expect(source).not.toContain('section-kicker');
    const headings = [
      ['snmp.page.pollingAndSecurity', 'Polling e segurança'],
      ['snmp.page.credentialsByPurpose', 'Credenciais por finalidade'],
      ['snmp.page.availabilityAndTraffic', 'Disponibilidade e tráfego'],
      ['snmp.page.recentTraps', 'Traps recentes'],
      ['snmp.page.drifts', 'Divergências'],
      ['snmp.page.changePreview', 'Pré-visualização da alteração'],
    ] as const;
    for (const [key, heading] of headings) {
      expect(source).toContain(`'${key}'`);
      expect(translateMessage('pt-PT', key)).toBe(heading);
    }
  });

  it('uses one shared 160×35px size and lets toolbar actions fit narrow screens', () => {
    expect(styles).toMatch(/\.snmp-workspace \.snmp-action-button,\.app-shell \.context-toolbar-actions \.snmp-action-button\s*\{[\s\S]*?width:\s*160px;[\s\S]*?height:\s*35px;/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*780px\)\s*\{\s*\.app-shell \.context-toolbar-actions \.snmp-action-button\s*\{\s*width:\s*160px;\s*min-width:\s*0;/);
    expect(styles).toMatch(/@media\s*\(max-width:780px\)\s*\{\s*\.app-shell \.context-toolbar\s*\{[\s\S]*?flex-direction:\s*column;/);
  });

  it('gives every SNMP field a visible 3px focus ring that the shared form rules cannot remove', () => {
    const rule = styles.match(/:is\(\.snmp-workspace,\.snmp-wizard,\.snmp-setup-panel,\.snmp-enrollment-modal,\.snmp-topbar-controls\) :is\(input,select,textarea\):focus-visible\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/outline:3px solid (?:var\(--t-focus,\s*#4f66c5\)|#4f66c5) !important/);
    expect(rule).toMatch(/outline-offset:2px !important/);
    // #4f66c5 is 5.2:1 on white, above the 3:1 needed for a focus indicator.
    expect(contrast('#4f66c5', '#ffffff')).toBeGreaterThanOrEqual(3);
  });

  it('uses a muted grey of at least 4.5:1 for SNMP text on every SNMP background', () => {
    const muted = styles.match(/\.snmp-workspace,\.snmp-wizard,\.snmp-setup-panel,\.snmp-enrollment-modal,\.snmp-topbar-controls \{ --muted:(#[0-9a-f]{6}); \}/)?.[1];
    expect(muted).toBeDefined();
    for (const background of ['#ffffff', '#fafafa', '#fcfbfb', '#f3f0f1', '#fff7e6']) expect(contrast(muted!, background), background).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#7d7b82', '#ffffff')).toBeLessThan(4.5);
  });
});

function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (light + 0.05) / (dark + 0.05);
}
