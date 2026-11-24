import { describe, expect, it } from 'vitest';
import { contrastMarkdownTable, knownDefaultLightExceptions, themeContrastResults } from './contrast-checks';
import { contrastRatio, themeCss, themes } from './themes';

describe('theme contrast (WCAG AA)', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  for (const result of themeContrastResults()) {
    it(`${result.theme} ${result.mode} meets AA`, () => {
      const exempt = result.theme === 'default' && result.mode === 'light' ? knownDefaultLightExceptions : [];
      const failures = result.checks.filter((check) => check.ratio < check.minimum && !exempt.includes(check.label)).map((check) => `${check.label}: ${check.foreground} on ${check.background} = ${check.ratio.toFixed(2)} (needs ${check.minimum})`);
      expect(failures).toEqual([]);
    });
  }

  it('prints the results table when asked', () => {
    // THEME_CONTRAST_REPORT=1 npx vitest run lib/theme prints the table used in the pull request.
    if (process.env.THEME_CONTRAST_REPORT) console.log(`\n${contrastMarkdownTable()}\n`);
    expect(contrastMarkdownTable()).toContain('| default | light |');
  });
});

describe('theme CSS', () => {
  it('leaves the default light theme untouched and defines every other theme and mode', () => {
    const css = themeCss();
    expect(css).not.toContain('[data-theme="default"][data-mode="light"]');
    expect(css).toContain('[data-theme="default"][data-mode="dark"]');
    for (const theme of themes.filter((item) => item.id !== 'default')) {
      expect(css).toContain(`[data-theme="${theme.id}"][data-mode="light"]`);
      expect(css).toContain(`[data-theme="${theme.id}"][data-mode="dark"]`);
    }
    expect(css).toContain('color-scheme:dark');
  });

  it('gives every theme variant the same token names', () => {
    const names = Object.keys(themes[1].light!).sort();
    for (const theme of themes) for (const tokens of [theme.light, theme.dark]) if (tokens) expect(Object.keys(tokens).sort()).toEqual(names);
  });
});
