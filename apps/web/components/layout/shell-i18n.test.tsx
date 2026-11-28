import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateMessage, type AppLocale } from '@/lib/i18n/i18n';
import { translateSourceText } from '@/lib/i18n/source-text-messages';
import { messages as deDE } from '@/lib/i18n/messages/shell/de-DE';
import { messages as esES } from '@/lib/i18n/messages/shell/es-ES';
import { messages as frFR } from '@/lib/i18n/messages/shell/fr-FR';
import { messages as itIT } from '@/lib/i18n/messages/shell/it-IT';
import { messages as ptPT } from '@/lib/i18n/messages/shell/pt-PT';

// The app shell moved from hard-coded Portuguese (translated on the page from source-text-messages.ts)
// to keyed messages. Each key renders exactly the old Portuguese literal, and en-US exactly what the
// source-text table made of it.
const keyed: Array<[key: string, portuguese: string, params?: Record<string, string | number>]> = [
  ['shell.sidebar.pin', 'Fixar menu aberto'],
  ['shell.sidebar.collapse', 'Recolher menu'],
  ['shell.search.fixTitle', 'Corrigir: sw-core-01', {title: 'sw-core-01'}],
  ['shell.search.fixDetail', 'Qualidade · abrir a página de correção'],
  ['shell.topbar.unavailableTitle', 'Ambiente indisponível'],
  ['shell.topbar.unavailableDetail', 'Não foi possível obter o estado dos serviços.'],
  ['shell.userMenu.user', 'Utilizador'],
  ['shell.userMenu.admin', 'Administrador'],
  ['shell.userMenu.logout', 'Terminar sessão'],
  ['shell.siteSwitcher.createError', 'Não foi possível criar o Site.'],
  ['shell.siteSwitcher.title', 'Adicionar localização'],
  ['shell.siteSwitcher.intro', 'Cria a base do Site e, se quiseres, a primeira hierarquia física.'],
  ['shell.siteSwitcher.step.identity', 'Identificação'],
  ['shell.siteSwitcher.step.location', 'Localização'],
  ['shell.siteSwitcher.step.confirm', 'Confirmar'],
  ['shell.siteSwitcher.step.done', 'Concluído'],
  ['shell.siteSwitcher.identityTitle', 'Como identificamos este Site?'],
  ['shell.siteSwitcher.identityHint', 'O nome é apresentado na navegação. O código curto distingue o Site em listas e integrações.'],
  ['shell.siteSwitcher.field.name', 'Nome do Site'],
  ['shell.siteSwitcher.field.namePlaceholder', 'Ex.: Sede Lisboa'],
  ['shell.siteSwitcher.field.code', 'Código curto'],
  ['shell.siteSwitcher.field.codePlaceholder', 'Ex.: LIS-01'],
  ['shell.siteSwitcher.field.address', 'Morada'],
  ['shell.siteSwitcher.field.addressPlaceholder', 'Rua, número'],
  ['shell.siteSwitcher.field.city', 'Cidade'],
  ['shell.siteSwitcher.field.cityPlaceholder', 'Lisboa'],
  ['shell.siteSwitcher.field.region', 'Região'],
  ['shell.siteSwitcher.field.regionPlaceholder', 'Lisboa'],
  ['shell.siteSwitcher.field.country', 'País'],
  ['shell.siteSwitcher.field.countryPlaceholder', 'Portugal'],
  ['shell.siteSwitcher.cancel', 'Cancelar'],
  ['shell.siteSwitcher.continue', 'Continuar'],
  ['shell.siteSwitcher.hierarchyTitle', 'Queres criar a hierarquia física?'],
  ['shell.siteSwitcher.hierarchyHint', 'Estes campos são opcionais. Podes adicionar edifícios, salas e bastidores mais tarde em Infraestrutura.'],
  ['shell.siteSwitcher.hierarchyOptional', 'Hierarquia física opcional'],
  ['shell.siteSwitcher.field.building', 'Edifício'],
  ['shell.siteSwitcher.field.buildingPlaceholder', 'Ex.: Edifício principal'],
  ['shell.siteSwitcher.field.room', 'Sala'],
  ['shell.siteSwitcher.field.roomPlaceholder', 'Ex.: Sala técnica'],
  ['shell.siteSwitcher.field.rack', 'Primeiro bastidor'],
  ['shell.siteSwitcher.field.rackPlaceholder', 'Ex.: RACK-01'],
  ['shell.siteSwitcher.back', 'Voltar'],
  ['shell.siteSwitcher.review', 'Rever'],
  ['shell.siteSwitcher.confirmTitle', 'Confirmar novo Site'],
  ['shell.siteSwitcher.confirmHint', 'Confirma os dados antes de criar a localização.'],
  ['shell.siteSwitcher.summary.code', 'Código'],
  ['shell.siteSwitcher.summary.location', 'Localização'],
  ['shell.siteSwitcher.summary.locationMissing', 'Não indicada'],
  ['shell.siteSwitcher.summary.hierarchy', 'Hierarquia'],
  ['shell.siteSwitcher.summary.hierarchyLater', 'Criar mais tarde'],
  ['shell.siteSwitcher.creating', 'A criar…'],
  ['shell.siteSwitcher.create', 'Criar Site'],
  ['shell.siteSwitcher.createdHint', 'O Site foi adicionado à organização e já pode ser usado como contexto ativo.'],
  ['shell.siteSwitcher.switch', 'Mudar para este Site'],
];
const sources = ['app-sidebar.tsx', 'global-search.tsx', 'topbar-state.ts', 'use-topbar-state.ts', 'user-menu.tsx', 'site-switcher.tsx'].map((file) => readFileSync(join(__dirname, file), 'utf8'));
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('shell keyed messages', () => {
  it.each(keyed)('%s renders the same Portuguese and English as before', (key, portuguese, params) => {
    expect(translateMessage('pt-PT', key, undefined, params)).toBe(portuguese);
    expect(translateMessage('en-US', key, undefined, params)).toBe(translateSourceText('en-US', portuguese));
  });

  it('has every key the app shell use, in both locales and the added languages', () => {
    expect(Object.keys(ptPT).sort()).toEqual(keyed.map(([key]) => key).sort());
    // Keys under this domain's prefixes (other `shell.*` keys in these files still live in i18n.tsx).
    const prefixes = [...new Set(keyed.map(([key]) => key.split('.').slice(0, 2).join('.') + '.'))];
    const used = new Set(sources.flatMap((source) => [...source.matchAll(/'(shell\.[\w.-]+)'/g)].map((match) => match[1])).filter((key) => prefixes.some((prefix) => key.startsWith(prefix))));
    for (const key of used) expect(ptPT, key).toHaveProperty([key]);
    for (const [key] of keyed) {
      for (const locale of ['pt-PT', 'en-US'] as AppLocale[]) expect(translateMessage(locale, key, '∅')).not.toBe('∅');
      for (const bundle of [esES, frFR, deDE, itIT]) expect(bundle[key], key).toBeTruthy();
    }
  });

  it('leaves no Portuguese literal in the app shell', () => {
    for (const source of ['app-sidebar.tsx', 'global-search.tsx', 'topbar-state.ts', 'use-topbar-state.ts', 'user-menu.tsx', 'site-switcher.tsx'].map((file) => withoutComments(readFileSync(join(__dirname, file), 'utf8')))) {
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
