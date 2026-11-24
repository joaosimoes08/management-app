import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, defaultLightReference, themes } from '@/lib/theme/themes';

const styles = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');
const allModes = themes.flatMap((theme) => (['light', 'dark'] as const).map((mode) => ({ name: `${theme.id} ${mode}`, t: theme[mode] ?? defaultLightReference })));

describe('Sidebar active entry style', () => {
  it('fills the active entry with the sidebar active token and white text', () => {
    expect(styles).toMatch(/\.app-shell \.sidebar\.app-sidebar \.nav-item\.active \{ color:#fff; background:var\(--t-sb-active,#315fc5\); \}/);
    expect(styles).toMatch(/\.app-shell \.nav-item\.active \{ color:#fff; background:var\(--t-sb-active/);
    // The link reset added with #170 only removes the underline; it must not reset colours or background.
    expect(styles).toMatch(/\.primary-nav a\.nav-item \{ text-decoration:none; \}/);
  });

  it('marks the active entry with a left bar and a heavier label, not only the fill', () => {
    expect(styles).toMatch(/\.app-shell \.sidebar\.app-sidebar \.nav-item\.active \{ font-weight:600; box-shadow:inset 3px 0 0 var\(--t-sb-text,#fff\)/);
  });

  it('keeps the active label readable and the left bar visible on the fill in every theme, light and dark', () => {
    for (const { name, t } of allModes) {
      expect(contrastRatio('#ffffff', t['sb-active']), `${name} label`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t['sb-text'], t['sb-active']), `${name} bar`).toBeGreaterThanOrEqual(3);
    }
  });
});
