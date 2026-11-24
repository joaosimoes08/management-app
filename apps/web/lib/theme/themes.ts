/**
 * Colour themes for the app. Each theme is a set of CSS custom properties applied under
 * `html[data-theme="<id>"][data-mode="light|dark"]`.
 *
 * globals.css writes its colours as `var(--t-<token>, <original colour>)`. The default theme in light
 * mode defines none of the `--t-*` tokens, so every rule falls back to its original colour and the
 * existing look is unchanged. Other themes (and default dark) define the tokens, plus the older
 * shared tokens (--ink, --muted, --line...), so the whole app follows without per-component styles.
 *
 * Palettes come from published, contrast-tested scales: Radix Colors (12-step scales) and Tailwind CSS
 * (50–950). Every theme is checked for WCAG AA in theme-contrast.test.ts.
 */

export type ThemeMode = 'light' | 'dark';
export type ThemeModePreference = ThemeMode | 'system';
export type ThemeId = 'default' | 'slate-blue' | 'zinc-indigo' | 'sand-teal' | 'stone-emerald' | 'high-contrast';

// Where a published step 11 text sat just under 4.5:1 on its own step-3 tint, the text is darkened one
// notch (Radix amber/green light, Radix blue light text). Dark-mode solids are nudged so both white
// labels (4.5:1) and the fill against the panel (3:1) pass.

/** 12 steps, Radix semantics: 1–2 backgrounds, 3–5 component fills, 6–8 borders, 9–10 solid, 11–12 text. */
type Scale = readonly [string, string, string, string, string, string, string, string, string, string, string, string];
type Status = { soft: string; line: string; text: string };
type StatusSet = Record<'red' | 'amber' | 'green' | 'violet', Status>;
type Accent = { soft: string; line: string; text: string; focus: string; solid: string };
type Variant = { gray: Scale; accent: Accent; status: StatusSet; sidebar: Scale };

export type ThemeTokens = Record<string, string>;
export type ThemeDefinition = { id: ThemeId; source: string; light: ThemeTokens | null; dark: ThemeTokens };

// --- Neutral scales ------------------------------------------------------------------------------
const radixSlate: Scale = ['#fcfcfd', '#f9f9fb', '#f0f0f3', '#e8e8ec', '#e0e1e6', '#d9d9e0', '#cdced6', '#b9bbc6', '#8b8d98', '#80838d', '#60646c', '#1c2024'];
const radixSlateDark: Scale = ['#111113', '#18191b', '#212225', '#272a2d', '#2e3135', '#363a3f', '#43484e', '#5a6169', '#696e77', '#777b84', '#b0b4ba', '#edeef0'];
const radixSand: Scale = ['#fdfdfc', '#f9f9f8', '#f1f0ef', '#e9e8e6', '#e2e1de', '#dad9d6', '#cfceca', '#bcbbb5', '#8d8d86', '#82827c', '#63635e', '#21201c'];
const radixSandDark: Scale = ['#111110', '#191918', '#222221', '#2a2a28', '#31312e', '#3b3a37', '#494844', '#62605b', '#6f6d66', '#7c7b74', '#b5b3ad', '#eeeeec'];
// Tailwind 50–950 laid onto the 12 steps.
const twZinc: Scale = ['#ffffff', '#fafafa', '#f4f4f5', '#f4f4f5', '#e4e4e7', '#e4e4e7', '#d4d4d8', '#a1a1aa', '#71717a', '#71717a', '#52525b', '#18181b'];
const twZincDark: Scale = ['#09090b', '#18181b', '#27272a', '#27272a', '#3f3f46', '#3f3f46', '#52525b', '#71717a', '#71717a', '#a1a1aa', '#a1a1aa', '#fafafa'];
const twStone: Scale = ['#ffffff', '#fafaf9', '#f5f5f4', '#f5f5f4', '#e7e5e4', '#e7e5e4', '#d6d3d1', '#a8a29e', '#78716c', '#78716c', '#57534e', '#1c1917'];
const twStoneDark: Scale = ['#0c0a09', '#1c1917', '#292524', '#292524', '#44403c', '#44403c', '#57534e', '#78716c', '#78716c', '#a8a29e', '#a8a29e', '#fafaf9'];
// Default theme dark: the navy of the existing sidebar, extended to a full scale.
const navyDark: Scale = ['#0b1220', '#111a2b', '#172236', '#1c2940', '#22314b', '#2a3a56', '#354766', '#46597b', '#6b7d9b', '#7b8ca8', '#a9b7cc', '#e8eef7'];
const contrastLight: Scale = ['#ffffff', '#ffffff', '#f2f2f2', '#e6e6e6', '#d9d9d9', '#767676', '#595959', '#4d4d4d', '#595959', '#333333', '#262626', '#000000'];
const contrastDark: Scale = ['#000000', '#0a0a0a', '#1a1a1a', '#262626', '#333333', '#8a8a8a', '#a6a6a6', '#b3b3b3', '#a6a6a6', '#cccccc', '#e0e0e0', '#ffffff'];

// --- Status colours (soft background, border, text) ---------------------------------------------
const radixStatusLight: StatusSet = {
  red: { soft: '#feebec', line: '#fdbdbe', text: '#ce2c31' },
  amber: { soft: '#fff7c2', line: '#f3d673', text: '#9a5a00' },
  green: { soft: '#e6f6eb', line: '#adddc0', text: '#1d7550' },
  violet: { soft: '#f4f0fe', line: '#d4cafe', text: '#6550b9' },
};
const radixStatusDark: StatusSet = {
  red: { soft: '#3b1219', line: '#72232d', text: '#ff9592' },
  amber: { soft: '#302008', line: '#5c3d05', text: '#ffca16' },
  green: { soft: '#132d21', line: '#20573e', text: '#3dd68c' },
  violet: { soft: '#291f43', line: '#473876', text: '#baa7ff' },
};
const twStatusLight: StatusSet = {
  red: { soft: '#fef2f2', line: '#fecaca', text: '#b91c1c' },
  amber: { soft: '#fffbeb', line: '#fde68a', text: '#b45309' },
  green: { soft: '#f0fdf4', line: '#bbf7d0', text: '#15803d' },
  violet: { soft: '#f5f3ff', line: '#ddd6fe', text: '#6d28d9' },
};
const twStatusDark: StatusSet = {
  red: { soft: '#450a0a', line: '#991b1b', text: '#f87171' },
  amber: { soft: '#451a03', line: '#92400e', text: '#fbbf24' },
  green: { soft: '#052e16', line: '#166534', text: '#4ade80' },
  violet: { soft: '#2e1065', line: '#5b21b6', text: '#a78bfa' },
};
const contrastStatusLight: StatusSet = {
  red: { soft: '#fff0f0', line: '#a00000', text: '#a00000' },
  amber: { soft: '#fff6e0', line: '#7a4100', text: '#7a4100' },
  green: { soft: '#ecfbef', line: '#005c1a', text: '#005c1a' },
  violet: { soft: '#f5f0ff', line: '#4c1d95', text: '#4c1d95' },
};
const contrastStatusDark: StatusSet = {
  red: { soft: '#2a0505', line: '#ff9b9b', text: '#ff9b9b' },
  amber: { soft: '#2a1a00', line: '#ffd27a', text: '#ffd27a' },
  green: { soft: '#032010', line: '#7ee2a0', text: '#7ee2a0' },
  violet: { soft: '#1d0f3d', line: '#c9b5ff', text: '#c9b5ff' },
};

function token(variant: Variant, mode: ThemeMode): ThemeTokens {
  const { gray: g, accent: a, status: s, sidebar: sb } = variant;
  const light = mode === 'light';
  const panel = light ? g[0] : g[1];
  const t: ThemeTokens = {
    canvas: light ? g[2] : g[0],
    panel,
    'panel-2': light ? g[1] : g[2],
    'panel-3': light ? g[2] : g[3],
    'panel-4': g[4],
    glass: withAlpha(panel, 0.92),
    line: g[5],
    'line-strong': g[8],
    text: g[11],
    'text-2': g[11],
    'text-3': g[10],
    'text-4': g[10],
    inverse: a.solid,
    accent: a.solid,
    focus: a.focus,
    'blue-soft': a.soft, 'blue-line': a.line, 'blue-text': a.text,
    'sb-bg': light ? sb[1] : sb[0],
    'sb-raised': sb[3],
    'sb-line': sb[5],
    'sb-text': sb[11],
    'sb-muted': sb[10],
    'sb-active': a.solid,
  };
  for (const [name, value] of Object.entries(s)) { t[`${name}-soft`] = value.soft; t[`${name}-line`] = value.line; t[`${name}-text`] = value.text; }
  return t;
}

function withAlpha(hex: string, alpha: number) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export const themes: ThemeDefinition[] = [
  {
    id: 'default', source: 'COCiber',
    light: null,
    dark: token({ gray: navyDark, sidebar: navyDark, status: radixStatusDark, accent: { soft: '#15284a', line: '#2f4f8a', text: '#9dbaf7', focus: '#6f94ec', solid: '#3767d4' } }, 'dark'),
  },
  {
    id: 'slate-blue', source: 'Radix Colors · Slate / Blue',
    light: token({ gray: radixSlate, sidebar: radixSlateDark, status: radixStatusLight, accent: { soft: '#e6f4fe', line: '#acd8fc', text: '#0b68b9', focus: '#0588f0', solid: '#0d74ce' } }, 'light'),
    dark: token({ gray: radixSlateDark, sidebar: radixSlateDark, status: radixStatusDark, accent: { soft: '#0d2847', line: '#104d87', text: '#70b8ff', focus: '#3b9eff', solid: '#0d74ce' } }, 'dark'),
  },
  {
    id: 'zinc-indigo', source: 'Tailwind CSS · Zinc / Indigo',
    light: token({ gray: twZinc, sidebar: twZincDark, status: twStatusLight, accent: { soft: '#eef2ff', line: '#c7d2fe', text: '#4338ca', focus: '#6366f1', solid: '#4f46e5' } }, 'light'),
    dark: token({ gray: twZincDark, sidebar: twZincDark, status: twStatusDark, accent: { soft: '#1e1b4b', line: '#3730a3', text: '#a5b4fc', focus: '#818cf8', solid: '#5b5bea' } }, 'dark'),
  },
  {
    id: 'sand-teal', source: 'Radix Colors · Sand / Teal',
    light: token({ gray: radixSand, sidebar: radixSandDark, status: radixStatusLight, accent: { soft: '#e0f8f3', line: '#a1ded2', text: '#00756a', focus: '#0d9b8a', solid: '#00756a' } }, 'light'),
    dark: token({ gray: radixSandDark, sidebar: radixSandDark, status: radixStatusDark, accent: { soft: '#0d2d2a', line: '#145750', text: '#0bd8b6', focus: '#12a594', solid: '#00756a' } }, 'dark'),
  },
  {
    id: 'stone-emerald', source: 'Tailwind CSS · Stone / Emerald',
    light: token({ gray: twStone, sidebar: twStoneDark, status: twStatusLight, accent: { soft: '#ecfdf5', line: '#a7f3d0', text: '#047857', focus: '#059669', solid: '#047857' } }, 'light'),
    dark: token({ gray: twStoneDark, sidebar: twStoneDark, status: twStatusDark, accent: { soft: '#022c22', line: '#065f46', text: '#34d399', focus: '#10b981', solid: '#047857' } }, 'dark'),
  },
  {
    id: 'high-contrast', source: 'WCAG AAA · Black / White',
    light: token({ gray: contrastLight, sidebar: contrastDark, status: contrastStatusLight, accent: { soft: '#e8efff', line: '#0040c1', text: '#0036a3', focus: '#0040c1', solid: '#0040c1' } }, 'light'),
    dark: token({ gray: contrastDark, sidebar: contrastDark, status: contrastStatusDark, accent: { soft: '#0a1a40', line: '#9ec1ff', text: '#9ec1ff', focus: '#9ec1ff', solid: '#3a6ae0' } }, 'dark'),
  },
];

/** The default light theme defines no tokens; these are the main colours the existing stylesheet uses (for the contrast check and the picker preview). */
export const defaultLightReference: ThemeTokens = {
  canvas: '#e9eef5', panel: '#ffffff', 'panel-2': '#faf9f9', 'panel-3': '#edf2f8', text: '#17243a', 'text-3': '#64738a', 'line-strong': '#8c8a91', line: '#dce4ef',
  focus: '#4f66c5', accent: '#315fc5', inverse: '#222222',
  'red-text': '#a14c41', 'red-soft': '#fff0ed', 'amber-text': '#946528', 'amber-soft': '#fff4df', 'green-text': '#32734d', 'green-soft': '#ecf7ef',
  'blue-text': '#315fc5', 'blue-soft': '#edf2ff', 'violet-text': '#755f95', 'violet-soft': '#f1ecf8',
  'sb-bg': '#14233b', 'sb-raised': '#1d304d', 'sb-text': '#e7edf8', 'sb-muted': '#96a7c0', 'sb-active': '#315fc5',
};

export function themeTokens(theme: ThemeDefinition, mode: ThemeMode): ThemeTokens { return theme[mode] ?? defaultLightReference; }

export const themeIds = themes.map((theme) => theme.id);
export const DEFAULT_THEME: ThemeId = 'default';
export const DEFAULT_MODE: ThemeModePreference = 'light';

/** The older shared tokens that globals.css reads as var(--ink) etc. */
function legacyTokens(t: ThemeTokens): ThemeTokens {
  return {
    ink: t.text, muted: t['text-3'], line: t.line, surface: t['panel-3'], panel: t.panel, text: t.text,
    blue: t['blue-text'], 'soft-blue': t['blue-soft'], green: t['green-text'], 'soft-green': t['green-soft'],
    purple: t['violet-text'], 'soft-purple': t['violet-soft'], red: t['red-text'], amber: t['amber-text'],
  };
}

/** CSS for every theme and mode, injected once in the root layout. */
export function themeCss() {
  const blocks: string[] = [];
  for (const theme of themes) {
    for (const mode of ['light', 'dark'] as const) {
      const tokens = theme[mode];
      if (!tokens) continue;
      const declarations = [
        ...Object.entries(tokens).map(([name, value]) => `--t-${name}:${value}`),
        ...Object.entries(legacyTokens(tokens)).map(([name, value]) => `--${name}:${value}`),
        `color-scheme:${mode}`,
      ];
      blocks.push(`html[data-theme="${theme.id}"][data-mode="${mode}"]{${declarations.join(';')}}`);
    }
  }
  return blocks.join('\n');
}

// --- WCAG contrast -----------------------------------------------------------------------------
export function rgb(hex: string): [number, number, number] {
  let value = hex.replace('#', '');
  if (value.length === 3) value = [...value].map((part) => part + part).join('');
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16)) as [number, number, number];
}
function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((channel) => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(foreground: string, background: string) {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
