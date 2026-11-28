import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { translateMessage } from './i18n';

// Text shown on screen comes from the message files (lib/i18n/messages/<domain>/<locale>.ts, the added
// languages in lib/i18n/locales and the core tables in i18n.tsx). An accented Portuguese literal anywhere
// else in apps/web is either a text that skipped translation or one of the cases below.
const webRoot = join(__dirname, '..', '..');
const accented = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/;

type Allowed = { file: string; text: string | RegExp; reason: string };

// Also allowed without an entry: the fallback of a key that exists in pt-PT and en-US (t('key', 'Texto'),
// { key, fallback: 'Texto' }, { key, label: 'Texto' }). It is never shown while the key exists, and the
// keyed tests check the key's values.
const allowed: Allowed[] = [
  { file: 'lib/api/errors.ts', text: /./, reason: 'pt-PT column of the API error-code, client-error, rack face and port layout tables, kept next to their English column' },
  { file: 'lib/i18n/locales/catalog.ts', text: /./, reason: 'native language names in the language picker (Português, Español, Français)' },
  { file: 'features/settings/settings-page.tsx', text: /./, reason: 'bilingual search keywords; matched against what the user types, never shown' },
  { file: 'features/portal/portal-page.tsx', text: 'Operações', reason: 'saved category value from the portal data, compared as data' },
  { file: 'features/topology/topology-page.tsx', text: 'já utilizadas', reason: 'matches the API\'s own error text to pick the error to show' },
  { file: 'lib/auth/api.ts', text: 'Identidade inválida devolvida pela API.', reason: 'internal error thrown on a malformed API reply; unchanged, not translated in any locale today' },
  { file: 'app/layout.tsx', text: /./, reason: 'HTML metadata description; unchanged, not translated in any locale today' },
  { file: 'features/infrastructure/types.ts', text: 'padrão', reason: 'power source value of the data model' },
  { file: 'features/infrastructure/components/editors/device-power-fields.tsx', text: /./, reason: 'power source value of the data model ("padrão")' },
  { file: 'features/settings/components/notification-channels-settings.tsx', text: /prevenção@empresa\.pt/, reason: 'example e-mail address in a placeholder' },
];

function sourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = relative(webRoot, path).split(sep).join('/');
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'coverage', 'public'].includes(entry.name) || rel === 'lib/i18n/messages' || rel === 'lib/i18n/locales/translations') continue;
      sourceFiles(path, files);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(entry.name)) {
      if (/^lib\/i18n\/locales\/[^/]+\.ts$/.test(rel) && rel !== 'lib/i18n/locales/catalog.ts' && rel !== 'lib/i18n/locales/loader.ts') continue;
      files.push(rel);
    }
  }
  return files;
}

const keyExists = (key: string) => translateMessage('pt-PT', key) !== key && translateMessage('en-US', key) !== key;

/** The key whose fallback this literal is, if it is one. */
function fallbackKey(node: ts.Node, file: ts.SourceFile): string | undefined {
  const parent = node.parent;
  if (ts.isCallExpression(parent) && parent.arguments[1] === node && parent.arguments[0] && ts.isStringLiteralLike(parent.arguments[0])) return parent.arguments[0].text;
  if (ts.isPropertyAssignment(parent) && ['fallback', 'label'].includes(parent.name.getText(file)) && ts.isObjectLiteralExpression(parent.parent)) {
    const key = parent.parent.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(file) === 'key');
    if (key && ts.isPropertyAssignment(key) && ts.isStringLiteralLike(key.initializer)) return key.initializer.text;
  }
  return undefined;
}

function accentedLiterals(rel: string) {
  const text = readFileSync(join(webRoot, rel), 'utf8');
  const file = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Array<{ file: string; line: number; text: string }> = [];
  const visit = (node: ts.Node) => {
    // The core message tables of i18n.tsx are translation files.
    if (rel === 'lib/i18n/i18n.tsx' && ts.isVariableDeclaration(node) && node.name.getText(file) === 'messages') return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const key = fallbackKey(node, file);
      if (accented.test(node.text) && !(key && keyExists(key))) found.push({ file: rel, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, text: node.text.trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const isAllowed = (literal: { file: string; text: string }) => allowed.some((entry) => entry.file === literal.file
  && (typeof entry.text === 'string' ? literal.text.includes(entry.text) : entry.text.test(literal.text)));

describe('Portuguese literals in apps/web', () => {
  const files = sourceFiles(webRoot);
  const literals = files.flatMap(accentedLiterals);

  it('scans the app source', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('lib/i18n/i18n.tsx');
    expect(files.some((file) => file.startsWith('lib/i18n/messages/'))).toBe(false);
  });

  it('has no accented Portuguese text outside the message files and the allow-list', () => {
    expect(literals.filter((literal) => !isAllowed(literal)).map(({ file, line, text }) => `${file}:${line} ${text.slice(0, 80)}`)).toEqual([]);
  });

  it('gives every allow-list entry a reason and a file that still needs it', () => {
    for (const entry of allowed) {
      expect(entry.reason.length, entry.file).toBeGreaterThan(10);
      expect(literals.some((literal) => literal.file === entry.file && (typeof entry.text === 'string' ? literal.text.includes(entry.text) : entry.text.test(literal.text))), `${entry.file} ${entry.text}`).toBe(true);
    }
  });

  it('catches a Portuguese literal', () => {
    expect(isAllowed({ file: 'features/example.tsx', text: 'Não foi possível guardar.' })).toBe(false);
    expect(keyExists('rack.pdu.readOnly')).toBe(true);
    expect(keyExists('rack.pdu.noSuchKey')).toBe(false);
  });
});
