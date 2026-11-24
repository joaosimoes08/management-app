import { contrastRatio, defaultLightReference, themes, type ThemeMode, type ThemeTokens } from './themes';

/** WCAG 2.2 AA: 4.5:1 for body text, 3:1 for large text and UI components (1.4.3, 1.4.11). */
export const AA_TEXT = 4.5;
export const AA_LARGE_UI = 3;

export type ContrastCheck = { group: 'text' | 'muted' | 'status' | 'button' | 'sidebar' | 'ui'; label: string; foreground: string; background: string; minimum: number; ratio: number };
export type ThemeContrastResult = { theme: string; mode: ThemeMode; checks: ContrastCheck[] };

function checksFor(t: ThemeTokens): ContrastCheck[] {
  const list: Omit<ContrastCheck, 'ratio'>[] = [];
  const add = (group: ContrastCheck['group'], label: string, foreground: string, background: string, minimum: number) => list.push({ group, label, foreground, background, minimum });
  for (const surface of ['canvas', 'panel', 'panel-2', 'panel-3']) add('text', `text on ${surface}`, t.text, t[surface], AA_TEXT);
  for (const surface of ['panel', 'panel-2', 'panel-3']) add('muted', `muted text on ${surface}`, t['text-3'], t[surface], AA_TEXT);
  for (const hue of ['red', 'amber', 'green', 'blue', 'violet']) {
    add('status', `${hue} text on panel`, t[`${hue}-text`], t.panel, AA_TEXT);
    add('status', `${hue} text on ${hue} soft`, t[`${hue}-text`], t[`${hue}-soft`], AA_TEXT);
  }
  add('button', 'white on primary', '#ffffff', t.inverse, AA_TEXT);
  add('button', 'white on accent', '#ffffff', t.accent, AA_TEXT);
  add('sidebar', 'sidebar text', t['sb-text'], t['sb-bg'], AA_TEXT);
  add('sidebar', 'sidebar text on raised', t['sb-text'], t['sb-raised'], AA_TEXT);
  add('sidebar', 'sidebar muted text', t['sb-muted'], t['sb-bg'], AA_TEXT);
  add('sidebar', 'white on active item', '#ffffff', t['sb-active'], AA_TEXT);
  add('ui', 'input border on panel', t['line-strong'], t.panel, AA_LARGE_UI);
  add('ui', 'focus ring on panel', t.focus, t.panel, AA_LARGE_UI);
  add('ui', 'focus ring on canvas', t.focus, t.canvas, AA_LARGE_UI);
  add('ui', 'accent on panel', t.accent, t.panel, AA_LARGE_UI);
  return list.map((check) => ({ ...check, ratio: contrastRatio(check.foreground, check.background) }));
}

export function themeContrastResults(): ThemeContrastResult[] {
  return themes.flatMap((theme) => (['light', 'dark'] as const).map((mode) => ({ theme: theme.id, mode, checks: checksFor(theme[mode] ?? defaultLightReference) })));
}

const groups: [ContrastCheck['group'], string][] = [['text', 'Text'], ['muted', 'Muted text'], ['status', 'Status text'], ['button', 'Button text'], ['sidebar', 'Sidebar'], ['ui', 'Borders / focus (3:1)']];

/** Markdown table: the lowest ratio per group for each theme and mode. */
export function contrastMarkdownTable(results = themeContrastResults()) {
  const header = `| Theme | Mode | ${groups.map(([, label]) => label).join(' | ')} | AA |`;
  const divider = `|---|---|${groups.map(() => '---:').join('|')}|:---:|`;
  const rows = results.map(({ theme, mode, checks }) => {
    const cells = groups.map(([group]) => { const worst = checks.filter((check) => check.group === group).reduce((low, check) => check.ratio < low.ratio ? check : low); return `${worst.ratio.toFixed(2)}`; });
    const failing = checks.filter((check) => check.ratio < check.minimum);
    return `| ${theme} | ${mode} | ${cells.join(' | ')} | ${failing.length === 0 ? '✅' : '❌'} |`;
  });
  return [header, divider, ...rows].join('\n');
}
