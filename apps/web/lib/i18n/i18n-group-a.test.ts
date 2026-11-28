// i18n group A (topbar, infrastructure, racks): every key these screens use resolves in both locales,
// so nothing falls back to the raw key or to Portuguese in English.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateMessage } from './i18n';

const web = path.resolve(import.meta.dirname, '../..');
const files = [
  'app/layout.tsx',
  'components/layout/app-header.tsx', 'components/layout/global-search.tsx', 'components/layout/site-switcher.tsx', 'components/layout/auth-gate.tsx',
  'components/layout/responsive-overflow.tsx', 'components/layout/locale-document-title.tsx',
  'features/infrastructure/infrastructure-workspace.tsx', 'features/infrastructure/components/lifecycle-dates.tsx',
  'features/infrastructure/components/device-image-frame.tsx', 'features/infrastructure/components/devices/cross-site-missing-config-list.tsx',
  'features/infrastructure/components/devices/device-import.tsx', 'features/infrastructure/components/devices/device-list.tsx',
  'features/infrastructure/components/devices/retirement-review-modal.tsx', 'features/infrastructure/components/editors/device-editor.tsx',
  'features/infrastructure/components/editors/editor-shared.tsx', 'features/infrastructure/components/editors/entity-editor.tsx',
  'features/infrastructure/components/models/interface-workspace.tsx', 'features/infrastructure/components/models/interface-editor.tsx',
  'features/infrastructure/components/models/port-layout-editor.tsx', 'features/infrastructure/components/rack/rack-detail.tsx',
  'features/infrastructure/components/rack/rack-equipment-overlay.tsx', 'features/infrastructure/components/rack/rack-equipment-preview.tsx',
  'features/infrastructure/components/rack/rack-power-summary.tsx', 'features/infrastructure/components/rack/rack-workspace.tsx',
  'features/infrastructure/device-360/device-360-page.tsx', 'features/tags/tag-components.tsx',
  'features/infrastructure/components/assets/asset-upload-modal.tsx',
];
const groupA = /^(topbar|globalSearch|siteSwitcher|authGate|infra|meta|tags\.deleteNamed)\b/;
// Template keys such as `infra.lifecycle.kind.${kind}` expand to these values.
const expansions: Record<string, string[]> = {
  'infra.tab.': ['sites', 'racks', 'devices', 'models', 'interfaces', 'assets', 'lifecycle', 'permissions'],
  'infra.lifecycle.kind.': ['LICENSE', 'WARRANTY', 'SUPPORT'],
  'infra.lifecycle.weekday.': ['0', '1', '2', '3', '4', '5', '6'],
  'infra.ports.': ['front.tab', 'rear.tab', 'front.image', 'rear.image', 'front.select', 'rear.select'],
  'infra.rack.noImage.': ['front', 'rear'],
  'infra.rack.faceImageOf.': ['front', 'rear'],
  'infra.rack.utilisation.': ['SUPPLIER', 'UPS'],
  'infra.rack.cardAria.': ['rearrange', 'reorder', 'open'],
  'infra.device360.connectionType.': ['logical', 'physical'],
  'infra.assets.namePlaceholder.': ['front', 'rear'],
};

function usedKeys() {
  const keys = new Set<string>();
  for (const file of files) {
    const source = fs.readFileSync(path.join(web, file), 'utf8');
    for (const match of source.matchAll(/\b(?:ui|t)\(\s*'([^']+)'/g)) if (groupA.test(match[1])) keys.add(match[1]);
    for (const match of source.matchAll(/\b(?:ui|t)\(\s*`([^`$]+)\$\{/g)) {
      if (!groupA.test(match[1])) continue;
      const values = expansions[match[1]];
      expect(values, `no expansion listed for template key ${match[1]}`).toBeDefined();
      for (const value of values ?? []) keys.add(match[1] + value);
    }
  }
  return [...keys];
}
const sentinel = '\u0000missing';
const sample = { count: 2 };
// translateMessage falls back to pt-PT, so an English entry is proven by a different text, except for
// these keys whose English text is the same as the Portuguese one by design.
const sameInBothLocales = new Set(['topbar.bellWithTodos', 'infra.tab.sites', 'infra.tab.interfaces', 'infra.tab.assets', 'infra.lifecycle.eventLabel', 'infra.siteCount']);

describe('i18n group A keys', () => {
  const keys = usedKeys();
  it('finds the keys used by the topbar, Infrastructure and racks', () => {
    expect(keys.length).toBeGreaterThan(150);
    expect(keys).toContain('infra.tab.lifecycle');
    expect(keys).toContain('siteSwitcher.activeSiteOf');
  });
  it.each(keys)('%s exists in pt-PT and en-US', (key) => {
    const portuguese = translateMessage('pt-PT', key, sentinel, sample);
    expect(portuguese).not.toBe(sentinel);
    if (!sameInBothLocales.has(key)) expect(translateMessage('en-US', key, sentinel, sample)).not.toBe(portuguese);
  });
  it('renders English for the reported strings', () => {
    expect(translateMessage('en-US', 'infra.tab.lifecycle')).toBe('Lifecycle');
    expect(translateMessage('pt-PT', 'infra.tab.lifecycle')).toBe('Ciclo de vida');
    expect(translateMessage('en-US', 'topbar.search')).toBe('Search');
    expect(translateMessage('en-US', 'siteSwitcher.activeSiteOf', undefined, { organization: 'EMGFA' })).toBe('EMGFA — Active Site');
    expect(translateMessage('en-US', 'topbar.activeAlerts', undefined, { count: 8 })).toBe('8 active alerts');
    expect(translateMessage('en-US', 'topbar.setupTaskCount', undefined, { count: 1 })).toBe('1 setup task');
    expect(translateMessage('en-US', 'meta.title')).toBe('Civernode · Infrastructure Management');
    expect(translateMessage('pt-PT', 'meta.title')).toBe('Civernode · Gestão de Infraestrutura');
    expect(translateMessage('en-US', 'infra.rack.reorderRacks')).toBe('Reorder racks');
    expect(translateMessage('en-US', 'infra.rack.cardAria.open', undefined, { name: 'R1', count: 1 })).toBe('Open rack R1, 1 device');
    expect(translateMessage('pt-PT', 'infra.rack.cardAria.open', undefined, { name: 'R1', count: 3 })).toBe('Abrir bastidor R1, 3 equipamentos');
  });
});
