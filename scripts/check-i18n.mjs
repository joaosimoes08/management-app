import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { collidingKeys, duplicateKeys, isKeyUsed, isSkippedDirectory, MESSAGES_DIRECTORY } from './i18n/domain-rules.mjs';

const root = process.cwd();

function sourceFile(relative, kind = ts.ScriptKind.TSX) {
  return ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), 'utf8'), ts.ScriptTarget.Latest, true, kind);
}

/** Every property name of `variableName`'s object literal, in order, duplicates included. */
function objectKeyList(variableName, source) {
  const keys = [];
  function visit(node) {
    let initializer = ts.isVariableDeclaration(node) ? node.initializer : undefined;
    // `{ ... } satisfies Record<K, string>` and `{ ... } as const` (per-domain message files).
    while (initializer && (ts.isSatisfiesExpression(initializer) || ts.isAsExpression(initializer))) initializer = initializer.expression;
    if (initializer && node.name.getText(source) === variableName && ts.isObjectLiteralExpression(initializer)) {
      for (const property of initializer.properties) {
        if (ts.isPropertyAssignment(property)) keys.push(ts.isStringLiteral(property.name) ? property.name.text : property.name.getText(source));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return keys;
}

function objectKeys(variableName, source) {
  return new Set(objectKeyList(variableName, source));
}

const i18n = sourceFile('apps/web/lib/i18n/i18n.tsx');
let localeKeys = {};
function visitMessages(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(i18n) === 'messages' && ts.isObjectLiteralExpression(node.initializer)) {
    for (const locale of node.initializer.properties) {
      if (!ts.isPropertyAssignment(locale) || !ts.isObjectLiteralExpression(locale.initializer)) continue;
      const name = ts.isStringLiteral(locale.name) ? locale.name.text : locale.name.getText(i18n);
      localeKeys[name] = new Set(locale.initializer.properties.filter(ts.isPropertyAssignment).map((property) => ts.isStringLiteral(property.name) ? property.name.text : property.name.getText(i18n)));
    }
  }
  ts.forEachChild(node, visitMessages);
}
visitMessages(i18n);

const ptKeys = localeKeys['pt-PT'] ?? new Set();
const enKeys = localeKeys['en-US'] ?? new Set();
const missingEnglish = [...ptKeys].filter((key) => !enKeys.has(key));
const missingPortuguese = [...enKeys].filter((key) => !ptKeys.has(key));

// Per-domain keyed messages: apps/web/lib/i18n/messages/<domain>/<locale>.ts, registered in messages/domains.ts.
// Found automatically; every domain must have all 6 locale files with exactly the keys of its pt-PT file.
const allLocales = ['pt-PT', 'en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT'];
const messagesRoot = MESSAGES_DIRECTORY;
const domainErrors = [];
const domainKeys = new Map(); // key -> domain
const domainNames = fs.readdirSync(path.join(root, messagesRoot), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const registry = fs.readFileSync(path.join(root, messagesRoot, 'domains.ts'), 'utf8');
const registeredDomains = [...registry.matchAll(/^export \{ (\w+) \} from '\.\/([\w-]+)';$/gm)].map((match) => match[2]);
for (const name of domainNames) if (!registeredDomains.includes(name)) domainErrors.push(`messages/${name}/ is not registered in messages/domains.ts`);
for (const name of registeredDomains) if (!domainNames.includes(name)) domainErrors.push(`messages/domains.ts registers "${name}", which has no messages/${name}/ folder`);
for (const domain of domainNames) {
  const index = path.join(root, messagesRoot, domain, 'index.ts');
  const indexText = fs.existsSync(index) ? fs.readFileSync(index, 'utf8') : '';
  if (!indexText) domainErrors.push(`messages/${domain}/index.ts is missing`);
  const keysByLocale = {};
  for (const locale of allLocales) {
    const relative = `${messagesRoot}/${domain}/${locale}.ts`;
    if (!fs.existsSync(path.join(root, relative))) { domainErrors.push(`messages/${domain}/${locale}.ts is missing`); continue; }
    const keyList = objectKeyList('messages', sourceFile(relative, ts.ScriptKind.TS));
    const duplicates = duplicateKeys(keyList);
    if (duplicates.length) domainErrors.push(`messages/${domain}/${locale}.ts lists a key more than once: ${duplicates.join(', ')}`);
    keysByLocale[locale] = new Set(keyList);
    if (locale !== 'pt-PT' && locale !== 'en-US' && indexText && !indexText.includes(`import('./${locale}')`)) domainErrors.push(`messages/${domain}/index.ts does not lazy-load ./${locale}`);
  }
  const source = keysByLocale['pt-PT'] ?? new Set();
  for (const locale of allLocales.slice(1)) {
    const keys = keysByLocale[locale];
    if (!keys) continue;
    const missing = [...source].filter((key) => !keys.has(key));
    const orphan = [...keys].filter((key) => !source.has(key));
    if (missing.length) domainErrors.push(`messages/${domain}/${locale}.ts is missing: ${missing.join(', ')}`);
    if (orphan.length) domainErrors.push(`messages/${domain}/${locale}.ts has keys not in pt-PT: ${orphan.join(', ')}`);
  }
  for (const key of source) {
    if (ptKeys.has(key) || enKeys.has(key)) domainErrors.push(`${key} is defined in messages/${domain}/ and in the i18n.tsx block`);
    else if (domainKeys.has(key)) domainErrors.push(`${key} is defined in messages/${domain}/ and messages/${domainKeys.get(key)}/`);
    else domainKeys.set(key, domain);
  }
}
// A domain key may not also be in a locales/<locale>.ts messages table: the loader spreads the domain
// table last, so the domain text would silently replace the other one.
for (const locale of ['es-ES', 'fr-FR', 'de-DE', 'it-IT']) {
  const tableKeys = objectKeys('messages', sourceFile(`apps/web/lib/i18n/locales/${locale}.ts`, ts.ScriptKind.TS));
  for (const key of collidingKeys(domainKeys.keys(), tableKeys)) domainErrors.push(`${key} is defined in messages/${domainKeys.get(key)}/ and in locales/${locale}.ts messages`);
}
// Orphan keys: a domain key no app code uses. Plural forms (.one/.other/...) count as their base key, and
// `prefix.${...}` template keys count for every key under that prefix.
const appSources = [];
(function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory() && isSkippedDirectory(path.relative(root, full))) continue;
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) appSources.push(fs.readFileSync(full, 'utf8'));
  }
})(path.join(root, 'apps/web'));
const appText = appSources.join('\n');
// messages/server/ is the exception: lib/i18n/server-text.ts finds those keys by the text the API sends, not by name.
for (const [key, domain] of domainKeys) {
  if (domain !== 'server' && !isKeyUsed(key, appText)) domainErrors.push(`${key} (messages/${domain}/) is not used by any app code`);
}

// `npm run i18n:check -- --locales[=es-ES,fr-FR]`: what each added language still lacks compared with en-US.
// Report only: translators fill these files in over time, so missing entries do not fail the run.
const localesArg = process.argv.slice(2).find((arg) => arg === '--locales' || arg.startsWith('--locales='));
if (localesArg) {
  const addedLocales = ['es-ES', 'fr-FR', 'de-DE', 'it-IT'];
  const wanted = localesArg.includes('=') ? localesArg.split('=')[1].split(',').filter(Boolean) : addedLocales;
  const unknown = wanted.filter((locale) => !addedLocales.includes(locale));
  if (unknown.length) {
    console.error(`Unknown locale(s): ${unknown.join(', ')}. Added locales: ${addedLocales.join(', ')}.`);
    process.exit(1);
  }
  const summary = [];
  for (const locale of wanted) {
    const relative = `apps/web/lib/i18n/locales/${locale}.ts`;
    const source = sourceFile(relative, ts.ScriptKind.TS);
    const keyed = objectKeys('messages', source);
    const missingKeyed = [...enKeys].filter((key) => !keyed.has(key));
    const extraKeyed = [...keyed].filter((key) => !enKeys.has(key));
    console.log(`\n== ${locale} (${relative})`);
    console.log(`Missing keyed messages (${missingKeyed.length} of ${enKeys.size}):`);
    for (const key of missingKeyed) console.log(`  ${key}`);
    if (extraKeyed.length) console.log(`Keyed messages not in en-US (unused): ${extraKeyed.join(', ')}`);
    summary.push({ locale, keyed: `${enKeys.size - missingKeyed.length}/${enKeys.size}` });
  }
  console.log('\nSummary (translated / en-US total); anything missing shows in English:');
  console.table(summary);
  process.exit(0);
}

if (missingEnglish.length || missingPortuguese.length || domainErrors.length) {
  if (missingEnglish.length) console.error(`Missing en-US keys: ${missingEnglish.join(', ')}`);
  if (missingPortuguese.length) console.error(`Missing pt-PT keys: ${missingPortuguese.join(', ')}`);
  if (domainErrors.length) console.error(`Per-domain messages (apps/web/lib/i18n/messages):\n${domainErrors.join('\n')}`);
  process.exit(1);
}
console.log(`i18n OK: ${ptKeys.size + domainKeys.size} keyed messages (${domainKeys.size} in ${domainNames.length} domain folder(s)).`);
