import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateMessage, type AppLocale } from '@/lib/i18n/i18n';
import { translateSourceText } from '@/lib/i18n/source-text-messages';
import { messages as deDE } from '@/lib/i18n/messages/audit/de-DE';
import { messages as esES } from '@/lib/i18n/messages/audit/es-ES';
import { messages as frFR } from '@/lib/i18n/messages/audit/fr-FR';
import { messages as itIT } from '@/lib/i18n/messages/audit/it-IT';
import { messages as ptPT } from '@/lib/i18n/messages/audit/pt-PT';

// The audit page moved from hard-coded Portuguese (translated on the page from source-text-messages.ts)
// to keyed messages. Each key renders exactly the old Portuguese literal, and en-US exactly what the
// source-text table made of it.
const keyed: Array<[key: string, portuguese: string, params?: Record<string, string | number>]> = [
  ['audit.system', 'Sistema'],
  ['audit.csvExported', 'CSV exportado.'],
  ['audit.csvExportError', 'Não foi possível exportar o CSV.'],
  ['audit.column.createdAt', 'Data e hora'],
  ['audit.column.action', 'Ação'],
  ['audit.column.entity', 'Registo'],
  ['audit.column.actor', 'Utilizador'],
  ['audit.column.diff', 'Antes → depois'],
  ['audit.column.open', 'Detalhe'],
  ['audit.viewDetail', 'Ver detalhe de device.update', {action: 'device.update'}],
  ['audit.openDetail', 'Abrir detalhe de device.update', {action: 'device.update'}],
  ['audit.diffRecorded', 'Registado'],
  ['audit.diffMissing', 'Sem registo'],
  ['audit.countLoaded', '7 eventos carregados', {count: 7}],
  ['audit.count', '7 eventos', {count: 7}],
  ['audit.section', 'Auditoria'],
  ['audit.search.placeholder', 'Pesquisar ação, registo, IP ou utilizador…'],
  ['audit.search.label', 'Pesquisar eventos de auditoria'],
  ['audit.filters', 'Filtros'],
  ['audit.filter.actor', 'Filtrar por utilizador'],
  ['audit.filter.entityTypeLabel', 'Tipo de registo'],
  ['audit.filter.entityType', 'Filtrar por tipo de registo'],
  ['audit.filter.action', 'Filtrar por ação'],
  ['audit.filter.from', 'Desde'],
  ['audit.filter.to', 'Até'],
  ['audit.filter.http', 'Pedidos HTTP'],
  ['audit.filter.allMasculine', 'Todos'],
  ['audit.filter.allFeminine', 'Todas'],
  ['audit.filter.hide', 'Ocultar'],
  ['audit.filter.show', 'Mostrar'],
  ['audit.filter.facetDays', 'Valores dos últimos 30 dias', {days: 30}],
  ['audit.clearFilters', 'Limpar filtros'],
  ['audit.exporting', 'A exportar…'],
  ['audit.exportCsv', 'Exportar CSV'],
  ['audit.refresh', 'Atualizar'],
  ['audit.description', 'Eventos administrativos, alterações de inventário e execuções de discovery, do mais recente para o mais antigo.'],
  ['audit.facetsTruncated', 'As listas de filtros foram limitadas a 500 valores. Escolhe um período para as reduzir.'],
  ['audit.table', 'Eventos de auditoria'],
  ['audit.emptyFiltered', 'Sem eventos correspondentes.'],
  ['audit.empty', 'Ainda não existem eventos de auditoria.'],
  ['audit.loading', 'A carregar…'],
  ['audit.loadMore', 'Carregar mais'],
  ['audit.detail.label', 'Detalhe de device.update', {action: 'device.update'}],
  ['audit.detail.close', 'Fechar'],
  ['audit.detail.ipAddress', 'Endereço IP'],
  ['audit.detail.openEntity', 'Abrir registo'],
  ['audit.detail.entityHistory', 'Histórico deste registo'],
  ['audit.detail.diffTable', 'Valores antes e depois'],
  ['audit.detail.field', 'Campo'],
  ['audit.detail.before', 'Antes'],
  ['audit.detail.after', 'Depois'],
  ['audit.detail.noDiff', 'Este evento não guardou os valores anteriores, por isso não há antes → depois. Mostram-se os dados registados.'],
  ['audit.detail.metadata', 'Dados registados'],
  ['audit.detail.noMetadata', 'Sem dados adicionais.'],
];
const sources = ['audit-page.tsx', 'workspace.ts'].map((file) => readFileSync(join(__dirname, file), 'utf8'));
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('audit keyed messages', () => {
  it.each(keyed)('%s renders the same Portuguese and English as before', (key, portuguese, params) => {
    expect(translateMessage('pt-PT', key, undefined, params)).toBe(portuguese);
    expect(translateMessage('en-US', key, undefined, params)).toBe(translateSourceText('en-US', portuguese));
  });

  it('has every key the audit page use, in both locales and the added languages', () => {
    expect(Object.keys(ptPT).sort()).toEqual(keyed.map(([key]) => key).sort());
    // Keys under this domain's prefixes (other `audit.*` keys in these files still live in i18n.tsx).
    const prefixes = [...new Set(keyed.map(([key]) => key.split('.').slice(0, 2).join('.') + '.'))];
    const used = new Set(sources.flatMap((source) => [...source.matchAll(/'(audit\.[\w.-]+)'/g)].map((match) => match[1])).filter((key) => prefixes.some((prefix) => key.startsWith(prefix))));
    for (const key of used) expect(ptPT, key).toHaveProperty([key]);
    for (const [key] of keyed) {
      for (const locale of ['pt-PT', 'en-US'] as AppLocale[]) expect(translateMessage(locale, key, '∅')).not.toBe('∅');
      for (const bundle of [esES, frFR, deDE, itIT]) expect(bundle[key], key).toBeTruthy();
    }
  });

  it('leaves no Portuguese literal in the audit page', () => {
    for (const source of ['audit-page.tsx', 'workspace.ts'].map((file) => withoutComments(readFileSync(join(__dirname, file), 'utf8')))) {
      expect(source).not.toMatch(/[áàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]/);
    }
    const code = sources.map(withoutComments).join('\n');
    for (const [key, portuguese, params] of keyed) {
      // Proper nouns and codes (Portugal, LIS-01) read the same in English and may appear elsewhere.
      if (params || translateSourceText('en-US', portuguese) === portuguese) continue;
      expect(code, key).not.toContain(`'${portuguese}'`);
      expect(code, key).not.toContain(`>${portuguese}<`);
    }
  });
});
