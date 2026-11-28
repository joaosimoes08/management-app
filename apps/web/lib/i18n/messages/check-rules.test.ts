import { describe, expect, it } from 'vitest';
import { collidingKeys, duplicateKeys, isKeyUsed, isSkippedDirectory } from '../../../../../scripts/i18n/domain-rules.mjs';

// The rules `npm run i18n:check` applies to messages/<domain>/ (scripts/check-i18n.mjs).
describe('i18n:check per-domain rules', () => {
  it('counts plural forms as their base key', () => {
    const app = "t('changePlans.devices', undefined, { count })";
    expect(isKeyUsed('changePlans.devices.one', app)).toBe(true);
    expect(isKeyUsed('changePlans.devices.other', app)).toBe(true);
    expect(isKeyUsed('changePlans.devices', app)).toBe(true);
    // The base key alone is not enough for a different base, and ".one" is not stripped mid-key.
    expect(isKeyUsed('changePlans.devicesTotal.one', app)).toBe(false);
    expect(isKeyUsed('changePlans.one.title', app)).toBe(false);
  });

  it('counts a template prefix for every key under it, but not string concatenation', () => {
    expect(isKeyUsed('tags.color.gray', 't(`tags.color.${color}`)')).toBe(true);
    expect(isKeyUsed('tags.label', 't(`tags.color.${color}`)')).toBe(false);
    expect(isKeyUsed('tags.color.gray', "t('tags.color.' + color)")).toBe(false);
    expect(isKeyUsed('tags.label', 'const label = "tags.label";')).toBe(true);
  });

  it('skips only the message folder itself, not app folders named messages', () => {
    expect(isSkippedDirectory('apps/web/lib/i18n/messages')).toBe(true);
    expect(isSkippedDirectory('apps/web/node_modules')).toBe(true);
    expect(isSkippedDirectory('apps/web/.next')).toBe(true);
    expect(isSkippedDirectory('apps/web/features/messages')).toBe(false);
    expect(isSkippedDirectory('apps/web/features/inbox/messages')).toBe(false);
  });

  it('finds a key listed twice in one file and a key also in a locales table', () => {
    expect(duplicateKeys(['tags.a', 'tags.b', 'tags.a'])).toEqual(['tags.a']);
    expect(duplicateKeys(['tags.a', 'tags.b'])).toEqual([]);
    expect(collidingKeys(['tags.a', 'infra.rack.x'], new Set(['infra.rack.x']))).toEqual(['infra.rack.x']);
  });
});
