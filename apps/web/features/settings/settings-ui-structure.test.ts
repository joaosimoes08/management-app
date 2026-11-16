import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const settings = read('features/settings/settings-page.tsx');
const groups = read('features/settings/components/access-groups-settings.tsx');
const directory = read('features/settings/components/directory-federation-settings.tsx');
const backup = read('features/settings/components/backup-export-panel.tsx');

describe('Settings page structure', () => {
  it('removes panel eyebrows and exposes configuration saves in the utility bar', () => {
    expect([settings, groups, directory, backup].join('\n')).not.toContain('section-kicker');

    for (const formId of [
      'settings-organization-form',
      'settings-discovery-form',
      'settings-snmp-form',
      'settings-audit-form',
      'settings-access-groups-form',
      'settings-directory-form',
    ]) {
      expect(settings + groups + directory).toContain(`form="${formId}"`);
      expect(settings + groups + directory).toContain(`id="${formId}"`);
    }
  });
});
