import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateMessage, type AppLocale } from '@/lib/i18n/i18n';
import { translateSourceText } from '@/lib/i18n/source-text-messages';
import { messages as deDE } from '@/lib/i18n/messages/settings/de-DE';
import { messages as esES } from '@/lib/i18n/messages/settings/es-ES';
import { messages as frFR } from '@/lib/i18n/messages/settings/fr-FR';
import { messages as itIT } from '@/lib/i18n/messages/settings/it-IT';
import { messages as ptPT } from '@/lib/i18n/messages/settings/pt-PT';

// The role request queue moved from hard-coded Portuguese (translated on the page from source-text-messages.ts)
// to keyed messages. Each key renders exactly the old Portuguese literal, and en-US exactly what the
// source-text table made of it.
const keyed: Array<[key: string, portuguese: string, params?: Record<string, string | number>]> = [
  ['settings.requests.filter.pending', 'Pendentes'],
  ['settings.requests.filter.approved', 'Aprovados'],
  ['settings.requests.filter.rejected', 'Rejeitados'],
  ['settings.requests.filter.all', 'Todos'],
  ['settings.requests.status.PENDING', 'Pendente'],
  ['settings.requests.status.PROCESSING', 'Em processamento'],
  ['settings.requests.status.APPROVED', 'Aprovado'],
  ['settings.requests.status.REJECTED', 'Rejeitado'],
  ['settings.requests.loadError', 'Não foi possível carregar os pedidos de roles.'],
  ['settings.requests.decideError', 'Não foi possível decidir o pedido.'],
  ['settings.requests.rejectTitle', 'Rejeitar pedido'],
  ['settings.requests.reject', 'Rejeitar'],
  ['settings.requests.title', 'Pedidos de roles'],
  ['settings.requests.column.user', 'Utilizador'],
  ['settings.requests.column.roles', 'Roles pedidos'],
  ['settings.requests.column.status', 'Estado'],
  ['settings.requests.column.createdAt', 'Pedido em'],
  ['settings.requests.column.decidedAt', 'Decisão'],
  ['settings.requests.column.actions', 'Ações'],
  ['settings.requests.finish', 'Concluir'],
  ['settings.requests.approve', 'Aprovar'],
  ['settings.requests.saving', 'A guardar…'],
  ['settings.requests.statusFilter', 'Estado'],
  ['settings.requests.refresh', 'Atualizar'],
  ['settings.requests.emptyPending', 'Não há pedidos de roles pendentes.'],
  ['settings.requests.empty', 'Não há pedidos de roles neste estado.'],
];
const sources = ['components/role-request-queue.tsx'].map((file) => readFileSync(join(__dirname, file), 'utf8'));
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('settings keyed messages', () => {
  it.each(keyed)('%s renders the same Portuguese and English as before', (key, portuguese, params) => {
    expect(translateMessage('pt-PT', key, undefined, params)).toBe(portuguese);
    expect(translateMessage('en-US', key, undefined, params)).toBe(translateSourceText('en-US', portuguese));
  });

  it('has every key the role request queue use, in both locales and the added languages', () => {
    expect(Object.keys(ptPT).sort()).toEqual(keyed.map(([key]) => key).sort());
    // Keys under this domain's prefixes (other `settings.*` keys in these files still live in i18n.tsx).
    const prefixes = [...new Set(keyed.map(([key]) => key.split('.').slice(0, 2).join('.') + '.'))];
    const used = new Set(sources.flatMap((source) => [...source.matchAll(/'(settings\.[\w.-]+)'/g)].map((match) => match[1])).filter((key) => prefixes.some((prefix) => key.startsWith(prefix))));
    for (const key of used) expect(ptPT, key).toHaveProperty([key]);
    for (const [key] of keyed) {
      for (const locale of ['pt-PT', 'en-US'] as AppLocale[]) expect(translateMessage(locale, key, '∅')).not.toBe('∅');
      for (const bundle of [esES, frFR, deDE, itIT]) expect(bundle[key], key).toBeTruthy();
    }
  });

  it('leaves no Portuguese literal in the role request queue', () => {
    for (const source of ['components/role-request-queue.tsx'].map((file) => withoutComments(readFileSync(join(__dirname, file), 'utf8')))) {
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
