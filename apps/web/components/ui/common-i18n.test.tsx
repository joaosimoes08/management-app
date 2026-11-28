import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateMessage, type AppLocale } from '@/lib/i18n/i18n';
import { translateSourceText } from '@/lib/i18n/source-text-messages';
import { messages as deDE } from '@/lib/i18n/messages/common/de-DE';
import { messages as esES } from '@/lib/i18n/messages/common/es-ES';
import { messages as frFR } from '@/lib/i18n/messages/common/fr-FR';
import { messages as itIT } from '@/lib/i18n/messages/common/it-IT';
import { messages as ptPT } from '@/lib/i18n/messages/common/pt-PT';

// The shared dialogs, toasts and data tables moved from hard-coded Portuguese (translated on the page from source-text-messages.ts)
// to keyed messages. Each key renders exactly the old Portuguese literal, and en-US exactly what the
// source-text table made of it (the toast kind label was a pt/en switch in the component, not a source-text entry).
const keyed: Array<[key: string, portuguese: string, params?: Record<string, string | number>]> = [
  ['common.ui.close', 'Fechar'],
  ['common.ui.time24', 'Hora (24 h)'],
  ['common.ui.toast.error', 'Erro'],
  ['common.ui.toast.warning', 'Atenção'],
  ['common.ui.toast.success', 'Sucesso'],
  ['common.table.sortAscending', 'ordem crescente'],
  ['common.table.sortDescending', 'ordem decrescente'],
  ['common.table.exportCsv', 'Exportar CSV'],
  ['common.table.historyNotes', 'Notas'],
  ['common.savedViews.copyLink', 'Copiar ligação desta vista'],
  ['common.savedViews.linkCopied', 'Ligação copiada'],
  ['common.savedViews.copyFailed', 'Não foi possível copiar a ligação'],
  ['common.savedViews.group', 'Vistas guardadas'],
  ['common.savedViews.view', 'Vista'],
  ['common.savedViews.apply', 'Aplicar vista guardada'],
  ['common.savedViews.current', 'Vista atual'],
  ['common.savedViews.none', 'Sem vistas guardadas'],
  ['common.savedViews.name', 'Nome da vista'],
  ['common.savedViews.saveName', 'Guardar'],
  ['common.savedViews.cancel', 'Cancelar'],
  ['common.savedViews.save', 'Guardar vista'],
  ['common.savedViews.deleteNamed', 'Apagar vista Críticos', {name: 'Críticos'}],
  ['common.savedViews.delete', 'Apagar vista'],
];
const englishBefore: Record<string, string> = {'common.ui.toast.success': 'Success'};
const sources = ['compact-modal.tsx', 'date-time-input.tsx', 'toast.tsx', '../data-table/data-table.tsx', '../data-table/history-block.tsx', '../data-table/saved-views.tsx'].map((file) => readFileSync(join(__dirname, file), 'utf8'));
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('common keyed messages', () => {
  it.each(keyed)('%s renders the same Portuguese and English as before', (key, portuguese, params) => {
    expect(translateMessage('pt-PT', key, undefined, params)).toBe(portuguese);
    expect(translateMessage('en-US', key, undefined, params)).toBe(englishBefore[key] ?? translateSourceText('en-US', portuguese));
  });

  it('has every key the shared dialogs, toasts and data tables use, in both locales and the added languages', () => {
    expect(Object.keys(ptPT).sort()).toEqual(keyed.map(([key]) => key).sort());
    // Keys under this domain's prefixes (other `common.*` keys in these files still live in i18n.tsx).
    const prefixes = [...new Set(keyed.map(([key]) => key.split('.').slice(0, 2).join('.') + '.'))];
    const used = new Set(sources.flatMap((source) => [...source.matchAll(/'(common\.[\w.-]+)'/g)].map((match) => match[1])).filter((key) => prefixes.some((prefix) => key.startsWith(prefix))));
    for (const key of used) expect(ptPT, key).toHaveProperty([key]);
    for (const [key] of keyed) {
      for (const locale of ['pt-PT', 'en-US'] as AppLocale[]) expect(translateMessage(locale, key, '∅')).not.toBe('∅');
      for (const bundle of [esES, frFR, deDE, itIT]) expect(bundle[key], key).toBeTruthy();
    }
  });

  it('leaves no Portuguese literal in the shared dialogs, toasts and data tables', () => {
    for (const source of ['compact-modal.tsx', 'date-time-input.tsx', 'toast.tsx', '../data-table/data-table.tsx', '../data-table/history-block.tsx', '../data-table/saved-views.tsx'].map((file) => withoutComments(readFileSync(join(__dirname, file), 'utf8')))) {
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
