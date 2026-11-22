import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const settings = read('features/settings/settings-page.tsx');
const groups = read('features/settings/components/access-groups-settings.tsx');
const backup = read('features/settings/components/backup-export-panel.tsx');

describe('Settings page structure', () => {
  it('omits the LDAP settings panel from the web UI', () => {
    expect(settings).not.toContain('directory-federation-settings');
    expect(settings).not.toContain('Diretório LDAP');
  });

  it('removes panel eyebrows and exposes configuration saves in the utility bar', () => {
    expect([settings, groups, backup].join('\n')).not.toContain('section-kicker');

    for (const formId of [
      'settings-organization-form',
      'settings-discovery-form',
      'settings-snmp-form',
      'settings-audit-form',
      'settings-access-groups-form',
    ]) {
      expect(settings + groups).toContain(`form="${formId}"`);
      expect(settings + groups).toContain(`id="${formId}"`);
    }
  });

  it('puts site creation, single-user editing, and backup operations in utility actions', () => {
    expect(settings).toContain("tab === 'sites' && <PageToolbarPortal>");
    expect(settings).toContain("tab === 'users' && selectedUser && <PageToolbarPortal>");
    expect(settings).toContain('className="settings-user-select"');
    expect(settings).toContain('nextSingleUserSelection(current, item.externalId');
    expect(settings).not.toContain('className="secondary-button" onClick={() => { setEditingUser(item)');
    expect(backup).toContain('<PageToolbarPortal>');
    expect(backup).toContain('form="settings-backup-check-form"');
    expect(backup).toContain('onClick={() => void downloadAnsible()}');
  });

  it('uses shaped skeletons for Settings, user-list, and backup loading states', () => {
    expect(settings).toContain('className="content-skeleton settings-loading-title"');
    expect(settings).toContain('settings-user-skeletons');
    expect(settings).not.toContain("className=\"spin\"/>");
    expect(backup).toContain('settings-loading-value');
    expect(groups).toContain('settings-group-skeletons');
  });

  it('links site counts to the Site in Infraestrutura / IPAM and shows the role-request queue to admins', () => {
    expect(settings).toContain('<Link href={`/infraestrutura?siteId=${encodeURIComponent(site.id)}`}');
    expect(settings).toContain('<Link href={`/ipam?siteId=${encodeURIComponent(site.id)}`}');
    expect(settings).toContain("tab === 'users' ? <>{admin && <RoleRequestQueue");
    expect(read('features/settings/components/role-request-queue.tsx')).not.toContain('section-kicker');
  });
});
