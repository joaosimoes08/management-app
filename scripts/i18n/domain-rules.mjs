// Pure rules of the per-domain message check (scripts/check-i18n.mjs), kept apart so
// apps/web/lib/i18n/messages/check-rules.test.ts can test them without the repo's real files.

/** The one folder the app-source walk skips besides node_modules and .next: the message files themselves. */
export const MESSAGES_DIRECTORY = 'apps/web/lib/i18n/messages';

/** Whether the app-source walk skips this directory, given its path relative to the repo root. */
export function isSkippedDirectory(relativePath) {
  const normalized = relativePath.split(/[\\/]+/).join('/');
  const name = normalized.split('/').pop();
  return name === 'node_modules' || name === '.next' || normalized === MESSAGES_DIRECTORY;
}

/** Keys listed more than once in one object literal, in order of their second appearance. */
export function duplicateKeys(keyList) {
  const seen = new Set();
  const duplicates = new Set();
  for (const key of keyList) {
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}

/**
 * Whether app code uses a domain key. Plural forms (.zero/.one/.two/.few/.many/.other) count as their
 * base key; a template literal `prefix.${…}` counts for every key under that prefix.
 */
export function isKeyUsed(key, appText) {
  const base = key.replace(/\.(zero|one|two|few|many|other)$/, '');
  const quoted = [`'${base}'`, `"${base}"`, `\`${base}\``].some((literal) => appText.includes(literal));
  if (quoted) return true;
  const parts = base.split('.');
  return parts.slice(1).some((_, index) => appText.includes(`\`${parts.slice(0, index + 1).join('.')}.\${`));
}

/** Domain keys that a `locales/<locale>.ts` messages table also defines (the loader spread would hide one). */
export function collidingKeys(domainKeys, localeTableKeys) {
  return [...domainKeys].filter((key) => localeTableKeys.has(key));
}
