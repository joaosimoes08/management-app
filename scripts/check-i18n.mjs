import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const operationalFiles = [
  'apps/web/features/dashboard/dashboard-page.tsx',
  'apps/web/features/discovery/discovery-page.tsx',
  'apps/web/features/portal/portal-page.tsx',
  'apps/web/features/operations/inventory-quality-page.tsx',
  'apps/web/features/operations/quality-bulk-dialog.tsx',
  'apps/web/features/operations/quality-workspace.ts',
  'apps/web/features/audit/audit-page.tsx',
  'apps/web/features/audit/workspace.ts',
  'apps/web/features/infrastructure/infrastructure-workspace.tsx',
  'apps/web/features/ipam/ipam-page.tsx',
  'apps/web/features/critical-assets/critical-assets-page.tsx',
  'apps/web/features/critical-assets/critical-assets-dialogs.tsx',
  'apps/web/features/critical-assets/workbench.ts',
  'apps/web/features/change-plans/change-plans-page.tsx',
  'apps/web/features/change-plans/change-calendar.tsx',
  'apps/web/features/change-plans/workspace.ts',
  'apps/web/components/data-table/data-table.tsx',
  'apps/web/components/data-table/entity-link.tsx',
  'apps/web/components/data-table/history-block.tsx',
  'apps/web/components/data-table/csv.ts',
  'apps/web/components/data-table/table-state.ts',
  'apps/web/components/data-table/use-table-url-state.ts',
  'apps/web/app/ajuda/page.tsx',
  'apps/web/app/ajuda/[topic]/page.tsx',
  // Phase D front end
  'apps/web/features/dashboard/drill-through.ts',
  'apps/web/features/infrastructure/device-filters.ts',
  'apps/web/features/ipam/subnet-filters.ts',
  'apps/web/features/operations/alert-configuration-page.tsx',
  'apps/web/features/operations/alerts-overview.tsx',
  'apps/web/components/layout/global-search.tsx',
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
const uncovered = [];
for (const relative of operationalFiles) {
  const source = sourceFile(relative);
  function visit(node) {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && portuguese.test(node.text) && !node.text.startsWith('/') && !legacyKeys.has(node.text)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      uncovered.push(`${relative}:${line + 1}: ${JSON.stringify(node.text)}`);
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
