import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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
  'apps/web/app/ajuda/page.tsx',
  'apps/web/app/ajuda/[topic]/page.tsx',
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

function objectKeys(variableName, source) {
  const keys = new Set();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === variableName && ts.isObjectLiteralExpression(node.initializer)) {
      for (const property of node.initializer.properties) {
        if (ts.isPropertyAssignment(property)) keys.add(ts.isStringLiteral(property.name) ? property.name.text : property.name.getText(source));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return keys;
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

const legacySource = sourceFile('apps/web/lib/i18n/legacy-messages.ts', ts.ScriptKind.TS);
const legacyKeys = objectKeys('enUS', legacySource);
const portuguese = /[áàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]|\b(Não|Sem|Criar|Editar|Eliminar|Guardar|Cancelar|Pesquisar|Definições|Descoberta|Infraestrutura|Equipamento|Bastidor|Sala|Edifício|Porta|permitidas|Aplicações|Auditoria|Ajuda|Anterior|Seguinte|Nome|Descrição|Estado|Operacional|disponível|associad|resultados|execução|utilizador|serviço|serviços|Últim|Novo|Nova|Voltar|Abrir|Fechar|Selecion|Carregar|Configura|Imagem|Modelo|Localização|Organização|Membros|Permissões|Ativa|Verificar|Ordem|Ainda|Apenas|Todos|Todas|livres|ocupados|manual|observado|Origem|Notas|Sistema operativo|Portas|Página|Nenhuma|Reordenar|Remover)\b/i;
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
      if (ts.isVariableDeclaration(node) && node.name.getText(legacySource) === 'substitutions' && node.initializer && ts.isArrayLiteralExpression(node.initializer)) count = node.initializer.elements.length;
      ts.forEachChild(node, visit);
    })(legacySource);
    return count;
  })();
  const summary = [];
  for (const locale of wanted) {
    const relative = `apps/web/lib/i18n/locales/${locale}.ts`;
    const source = sourceFile(relative, ts.ScriptKind.TS);
    const keyed = objectKeys('messages', source);
    const legacy = objectKeys('legacy', source);
    let substitutions = 0;
    (function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'substitutions' && node.initializer && ts.isArrayLiteralExpression(node.initializer)) substitutions = node.initializer.elements.length;
      ts.forEachChild(node, visit);
    })(source);
    const missingKeyed = [...enKeys].filter((key) => !keyed.has(key));
    const missingLegacy = [...legacyKeys].filter((key) => !legacy.has(key));
    const extraKeyed = [...keyed].filter((key) => !enKeys.has(key));
    const extraLegacy = [...legacy].filter((key) => !legacyKeys.has(key));
    console.log(`\n== ${locale} (${relative})`);
    console.log(`Missing keyed messages (${missingKeyed.length} of ${enKeys.size}):`);
    for (const key of missingKeyed) console.log(`  ${key}`);
    console.log(`Missing legacy entries (${missingLegacy.length} of ${legacyKeys.size}):`);
    for (const key of missingLegacy) console.log(`  ${JSON.stringify(key)}`);
    if (extraKeyed.length) console.log(`Keyed messages not in en-US (unused): ${extraKeyed.join(', ')}`);
    if (extraLegacy.length) console.log(`Legacy entries not in the English table (unused): ${extraLegacy.map((key) => JSON.stringify(key)).join(', ')}`);
    summary.push({ locale, keyed: `${enKeys.size - missingKeyed.length}/${enKeys.size}`, legacy: `${legacyKeys.size - missingLegacy.length}/${legacyKeys.size}`, substitutions: `${substitutions} (en-US has ${englishSubstitutions})` });
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
    if ((snmpText || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && portuguese.test(value) && !value.startsWith('/') && !legacyKeys.has(value)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      uncovered.push(`${relative}:${line + 1}: ${JSON.stringify(value)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

if (missingEnglish.length || missingPortuguese.length || uncovered.length) {
  if (missingEnglish.length) console.error(`Missing en-US keys: ${missingEnglish.join(', ')}`);
  if (missingPortuguese.length) console.error(`Missing pt-PT keys: ${missingPortuguese.join(', ')}`);
  if (uncovered.length) console.error(`Uncovered legacy UI messages:\n${uncovered.join('\n')}`);
  process.exit(1);
}
console.log(`i18n OK: ${ptKeys.size} keyed messages and ${legacyKeys.size} covered legacy messages.`);
