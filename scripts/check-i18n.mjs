import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { collidingKeys, duplicateKeys, isKeyUsed, isSkippedDirectory, MESSAGES_DIRECTORY } from './i18n/domain-rules.mjs';

const root = process.cwd();
const operationalFiles = [
  'apps/web/features/dashboard/dashboard-page.tsx',
  'apps/web/features/snmp/health/health-badge.tsx',
  'apps/web/features/snmp/health/health-panel.tsx',
  'apps/web/features/snmp/health/device-picker.tsx',
  'apps/web/features/snmp/health/thresholds-api.ts',
  'apps/web/features/snmp/health/thresholds-editor.tsx',
  'apps/web/features/snmp/health/health-limits-panels.tsx',
  'apps/web/features/snmp/health/health-history-chart.tsx',
  'apps/web/features/discovery/discovery-page.tsx',
  'apps/web/features/discovery/discovery-snmp-enrichment.tsx',
  'apps/web/features/portal/portal-page.tsx',
  'apps/web/features/operations/inventory-quality-page.tsx',
  'apps/web/features/operations/quality-bulk-dialog.tsx',
  'apps/web/features/operations/quality-workspace.ts',
  'apps/web/features/portal/check-all-panel.tsx',
  'apps/web/features/netapp/netapp-capacity.tsx',
  'apps/web/features/infrastructure/components/rack/rack-power-summary.tsx',
  'apps/web/features/settings/components/role-request-queue.tsx',
  'apps/web/features/audit/audit-page.tsx',
  'apps/web/features/audit/workspace.ts',
  'apps/web/features/infrastructure/infrastructure-workspace.tsx',
  'apps/web/features/infrastructure/tabs/tab-navigation.tsx',
  'apps/web/features/infrastructure/tabs/devices-tab.tsx',
  'apps/web/features/infrastructure/hooks/use-power-step.ts',
  'apps/web/features/ipam/ipam-page.tsx',
  'apps/web/features/critical-assets/critical-assets-page.tsx',
  'apps/web/features/critical-assets/critical-assets-dialogs.tsx',
  'apps/web/features/critical-assets/workbench.ts',
  'apps/web/features/change-plans/change-plans-page.tsx',
  'apps/web/features/change-plans/change-calendar.tsx',
  'apps/web/features/change-plans/change-execution.tsx',
  'apps/web/features/change-plans/workspace.ts',
  'apps/web/components/data-table/data-table.tsx',
  'apps/web/components/data-table/entity-link.tsx',
  'apps/web/lib/routes.ts',
  'apps/web/components/data-table/history-block.tsx',
  'apps/web/components/data-table/csv.ts',
  'apps/web/components/data-table/table-state.ts',
  'apps/web/components/data-table/use-table-url-state.ts',
  'apps/web/components/data-table/saved-views.tsx',
  'apps/web/features/help/articles.ts',
  'apps/web/features/help/help-index-page.tsx',
  'apps/web/features/help/help-article-page.tsx',
  // Phase D front end
  'apps/web/features/dashboard/drill-through.ts',
  'apps/web/features/infrastructure/device-filters.ts',
  'apps/web/features/ipam/subnet-filters.ts',
  'apps/web/features/operations/alert-configuration-page.tsx',
  'apps/web/features/operations/alerts-overview.tsx',
  'apps/web/components/layout/global-search.tsx',
  // Phase E IPAM/Descoberta/SNMP
  'apps/web/features/ipam/components/next-free-ip-modal.tsx',
  'apps/web/features/ipam/components/subnets-view.tsx',
  'apps/web/features/ipam/utilization.ts',
  'apps/web/features/topology/filters.ts',
  'apps/web/features/topology/topology-filters-menu.tsx',
  'apps/web/features/discovery/bulk-review-dialog.tsx',
  'apps/web/features/discovery/discovery-results.tsx',
  'apps/web/features/discovery/discovery-missing.tsx',
  // Discovery P0 quick fixes
  'apps/web/features/discovery/discovery-status.ts',
  'apps/web/features/discovery/discovery-run-parts.tsx',
  'apps/web/features/discovery/discovery-schedule-panel.tsx',
  // D-P2c discovery schedules overview
  'apps/web/features/discovery/discovery-schedules-overview.tsx',
  // D-P2b discovery results tools and scan estimate
  'apps/web/features/discovery/discovery-results-tools.tsx',
  'apps/web/features/discovery/discovery-scan-estimate.tsx',
  // D-P1b promote a discovery result to a device
  'apps/web/features/discovery/discovery-promote.tsx',
  'apps/web/features/infrastructure/discovery-promotion.tsx',
  // D-P2a structured scan outcomes
  'apps/web/features/discovery/discovery-outcomes.tsx',
  // D-P1c identity candidates
  'apps/web/features/discovery/discovery-identity.tsx',
  'apps/web/features/snmp/snmp-fleet.tsx',
  'apps/web/features/snmp/snmp-page.tsx',
  'apps/web/features/snmp/snmp-drifts.tsx',
  'apps/web/features/snmp/snmp-bounds.ts',
  'apps/web/features/snmp/snmp-change-plan-attach.tsx',
  // SNMP Phase 1 guided setup and trap panel
  'apps/web/features/snmp/snmp-setup.ts',
  'apps/web/features/snmp/snmp-setup-panel.tsx',
  'apps/web/features/snmp/snmp-setup-wizard.tsx',
  'apps/web/features/snmp/snmp-unknown-traps.tsx',
  // SNMP step 1.3 rev. 4: v2c allowed alongside v3
  'apps/web/features/snmp/snmp-version.tsx',
  // Step 34 impact analysis and path view
  'apps/web/features/topology/impact-panel.tsx',
  'apps/web/features/topology/impact-api.ts',
  'apps/web/features/change-plans/plan-impact.tsx',
  // Step 36 tags on devices and subnets
  'apps/web/features/tags/tag-components.tsx',
  // SNMP Phase 1: alert actions, detail, severity meanings
  'apps/web/features/operations/alert-meta.ts',
  'apps/web/features/operations/alert-actions.tsx',
  'apps/web/features/operations/alert-detail.tsx',
  'apps/web/features/operations/alert-severity.tsx',
  'apps/web/features/operations/operations-panel.tsx',
  'apps/web/components/layout/app-header.tsx',
  'apps/web/features/snmp/snmp-credential-usage.ts',
];

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

const sourceTextSource = sourceFile('apps/web/lib/i18n/source-text-messages.ts', ts.ScriptKind.TS);
const sourceTextKeys = objectKeys('enUS', sourceTextSource);
const portuguese = /[áàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]|\b(Não|Sem|Criar|Editar|Eliminar|Guardar|Cancelar|Pesquisar|Definições|Descoberta|Infraestrutura|Equipamento|Bastidor|Sala|Edifício|Porta|permitidas|Aplicações|Auditoria|Ajuda|Anterior|Seguinte|Nome|Descrição|Estado|Operacional|disponível|associad|resultados|execução|utilizador|serviço|serviços|Últim|Novo|Nova|Voltar|Abrir|Fechar|Selecion|Carregar|Configura|Imagem|Modelo|Localização|Organização|Membros|Permissões|Ativa|Verificar|Ordem|Ainda|Apenas|Todos|Todas|livres|ocupados|manual|observado|Origem|Notas|Sistema operativo|Portas|Página|Nenhuma|Reordenar|Remover)\b/i;
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
for (const [key, domain] of domainKeys) {
  if (!isKeyUsed(key, appText)) domainErrors.push(`${key} (messages/${domain}/) is not used by any app code`);
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
  const englishSubstitutions = (() => {
    let count = 0;
    (function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(sourceTextSource) === 'substitutions' && node.initializer && ts.isArrayLiteralExpression(node.initializer)) count = node.initializer.elements.length;
      ts.forEachChild(node, visit);
    })(sourceTextSource);
    return count;
  })();
  const summary = [];
  for (const locale of wanted) {
    const relative = `apps/web/lib/i18n/locales/${locale}.ts`;
    const source = sourceFile(relative, ts.ScriptKind.TS);
    const keyed = objectKeys('messages', source);
    const sourceText = objectKeys('sourceText', source);
    let substitutions = 0;
    (function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'substitutions' && node.initializer && ts.isArrayLiteralExpression(node.initializer)) substitutions = node.initializer.elements.length;
      ts.forEachChild(node, visit);
    })(source);
    const missingKeyed = [...enKeys].filter((key) => !keyed.has(key));
    const missingSourceText = [...sourceTextKeys].filter((key) => !sourceText.has(key));
    const extraKeyed = [...keyed].filter((key) => !enKeys.has(key));
    const extraSourceText = [...sourceText].filter((key) => !sourceTextKeys.has(key));
    console.log(`\n== ${locale} (${relative})`);
    console.log(`Missing keyed messages (${missingKeyed.length} of ${enKeys.size}):`);
    for (const key of missingKeyed) console.log(`  ${key}`);
    console.log(`Missing source-text entries (${missingSourceText.length} of ${sourceTextKeys.size}):`);
    for (const key of missingSourceText) console.log(`  ${JSON.stringify(key)}`);
    if (extraKeyed.length) console.log(`Keyed messages not in en-US (unused): ${extraKeyed.join(', ')}`);
    if (extraSourceText.length) console.log(`Source-text entries not in the English table (unused): ${extraSourceText.map((key) => JSON.stringify(key)).join(', ')}`);
    summary.push({ locale, keyed: `${enKeys.size - missingKeyed.length}/${enKeys.size}`, sourceText: `${sourceTextKeys.size - missingSourceText.length}/${sourceTextKeys.size}`, substitutions: `${substitutions} (en-US has ${englishSubstitutions})` });
  }
  console.log('\nSummary (translated / en-US total); anything missing shows in English:');
  console.table(summary);
  process.exit(0);
}

const uncovered = [];
for (const relative of operationalFiles) {
  const source = sourceFile(relative);
  function visit(node) {
    const snmpText = relative.endsWith('/snmp-page.tsx') && ts.isJsxText(node);
    const value = snmpText ? node.text.trim() : node.text;
    if ((snmpText || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && portuguese.test(value) && !value.startsWith('/') && !sourceTextKeys.has(value)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      uncovered.push(`${relative}:${line + 1}: ${JSON.stringify(value)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

if (missingEnglish.length || missingPortuguese.length || uncovered.length || domainErrors.length) {
  if (missingEnglish.length) console.error(`Missing en-US keys: ${missingEnglish.join(', ')}`);
  if (missingPortuguese.length) console.error(`Missing pt-PT keys: ${missingPortuguese.join(', ')}`);
  if (uncovered.length) console.error(`Uncovered source-text UI messages:\n${uncovered.join('\n')}`);
  if (domainErrors.length) console.error(`Per-domain messages (apps/web/lib/i18n/messages):\n${domainErrors.join('\n')}`);
  process.exit(1);
}
console.log(`i18n OK: ${ptKeys.size + domainKeys.size} keyed messages (${domainKeys.size} in ${domainNames.length} domain folder(s)) and ${sourceTextKeys.size} covered source-text messages.`);
