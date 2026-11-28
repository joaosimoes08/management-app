import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateMessage, type AppLocale } from '@/lib/i18n/i18n';
import { messages as deDE } from '@/lib/i18n/messages/portal/de-DE';
import { messages as esES } from '@/lib/i18n/messages/portal/es-ES';
import { messages as frFR } from '@/lib/i18n/messages/portal/fr-FR';
import { messages as itIT } from '@/lib/i18n/messages/portal/it-IT';

const files = ['portal-page.tsx', 'check-all-panel.tsx'];
// Keyed in i18n.tsx before this change.
const keyedBefore = ['portal.appCount', 'portal.checkAll.progress', 'portal.checkAll.progressOpen', 'portal.urlScheme'];

// The portal screens moved from hard-coded Portuguese (translated on the page from source-text-messages.ts)
// to keyed messages. Each key renders exactly the old Portuguese, and en-US what the page showed before.
// Two English values are corrections: the source-text table left "Experimenta outra pesquisa." and the
// "Ex.: Zabbix" placeholder in Portuguese.
type Expected = string | (() => string);
const keyed: Array<[key: string, portuguese: string, params?: Record<string, string | number>, english?: Expected]> = [
  ['portal.outcome.available', "Disponível"],
  ['portal.outcome.unavailable', "Indisponível"],
  ['portal.outcome.unreachable', "Inacessível"],
  ['portal.outcome.blocked', "Bloqueado"],
  ['portal.outcome.invalidUrl', "URL inválido"],
  ['portal.outcome.unchecked', "Não verificado"],
  ['portal.checkAll.error', "Não foi possível verificar as aplicações."],
  ['portal.checkAll.application', "Aplicação"],
  ['portal.checkAll.result', "Resultado"],
  ['portal.checkAll.time', "Tempo"],
  ['portal.checkAll.checkedAt', "Verificado em"],
  ['portal.checkAll.detail', "Detalhe"],
  ['portal.checkAll.blockedDetail', "O endereço de destino pertence a uma rede restrita."],
  ['portal.checkAll.title', "Verificar todas as aplicações"],
  ['portal.checkAll.scope', "Âmbito"],
  ['portal.checkAll.scopeChecked', "Só com verificação de disponibilidade"],
  ['portal.checkAll.scopeAll', "Todas as aplicações ativas"],
  ['portal.checkAll.stop', "Parar"],
  ['portal.checkAll.start', "Iniciar verificação"],
  ['portal.checkAll.empty', "Não há aplicações para verificar neste âmbito."],
  ['portal.checkAll.resultsLabel', "Resultados da verificação"],
  ['portal.checkAll.outcomeCount', '{label}: {count}'],
  ['portal.close', "Fechar"],
  ['portal.role.admin', "Administrador"],
  ['portal.role.networkOperator', "Operador de rede"],
  ['portal.role.systemsOperator', "Operador de sistemas"],
  ['portal.role.auditor', "Auditor"],
  ['portal.role.readOnly', "Apenas leitura"],
  ['portal.saveError', "Não foi possível guardar a aplicação."],
  ['portal.remove.title', "Remover aplicação"],
  ['portal.remove.message', "Remover esta aplicação do portal?"],
  ['portal.remove.action', "Remover"],
  ['portal.remove.error', "Não foi possível remover a aplicação."],
  ['portal.favorite.error', "Não foi possível atualizar os favoritos."],
  ['portal.favorite.removeNamed', "Remover Zabbix dos favoritos", { name: 'Zabbix' }],
  ['portal.favorite.addNamed', "Adicionar Zabbix aos favoritos", { name: 'Zabbix' }],
  ['portal.favorite.remove', "Remover dos favoritos"],
  ['portal.favorite.add', "Adicionar aos favoritos"],
  ['portal.checkError', "Não foi possível verificar a disponibilidade."],
  ['portal.open', "Abrir aplicação"],
  ['portal.edit', "Editar"],
  ['portal.checkAvailability', "Verificar disponibilidade"],
  ['portal.section', "Portal interno"],
  ['portal.search.placeholder', "Pesquisar aplicações…"],
  ['portal.search.scope', "Aplicações"],
  ['portal.refresh', "Atualizar"],
  ['portal.checkAllButton', "Verificar todas"],
  ['portal.new', "Nova aplicação"],
  ['portal.title', "Aplicações chave"],
  ['portal.form.edit', "Editar aplicação"],
  ['portal.form.name', "Nome"],
  ['portal.form.namePlaceholder', "Ex.: Zabbix", undefined, 'e.g. Zabbix'],
  ['portal.form.category', "Categoria"],
  ['portal.form.categoryPlaceholder', "Monitorização"],
  ['portal.form.description', "Descrição"],
  ['portal.form.descriptionPlaceholder', "Monitorização e alertas"],
  ['portal.form.icon', "Ícone"],
  ['portal.form.order', "Ordem"],
  ['portal.form.roles', "Roles autorizadas · sem seleção, visível para todos"],
  ['portal.form.active', "Ativa"],
  ['portal.form.save', "Guardar"],
  ['portal.loading', "A carregar aplicações..."],
  ['portal.empty.noMatches', "Sem aplicações correspondentes"],
  ['portal.empty.none', "Ainda não existem aplicações"],
  ['portal.empty.tryAnother', "Experimenta outra pesquisa.", undefined, 'Try another search.'],
  ['portal.empty.adminHint', "Adiciona a primeira aplicação chave ao catálogo."],
  ['portal.empty.userHint', "Ainda não existem aplicações disponíveis para o teu perfil."],
  ['portal.favorites.title', "Os meus favoritos"],
];

describe('portal keyed messages', () => {
  it.each(keyed.filter(([key]) => key !== 'portal.checkAll.outcomeCount'))('%s renders the same Portuguese and English as before', (key, portuguese, params, english) => {
    expect(translateMessage('pt-PT', key, undefined, params)).toBe(portuguese);
    const expected = typeof english === 'function' ? english() : english;
    if (expected !== undefined) expect(translateMessage('en-US', key, undefined, params)).toBe(expected);
  });

  it('renders the outcome count as before, with the label already in the active language', () => {
    expect(translateMessage('pt-PT', 'portal.checkAll.outcomeCount', undefined, { label: 'Disponível', count: 3 })).toBe('Disponível: 3');
    expect(translateMessage('en-US', 'portal.checkAll.outcomeCount', undefined, { label: 'Available', count: 3 })).toBe('Available: 3');
  });

  it('covers every key the portal components use, in both locales and the added languages', () => {
    const used = new Set(files.flatMap((file) => [...readFileSync(join(__dirname, file), 'utf8').matchAll(/'(portal\.[\w.]+)'/g)].map((match) => match[1])));
    for (const key of keyedBefore) used.delete(key);
    expect([...used].sort()).toEqual(keyed.map(([key]) => key).sort());
    for (const [key] of keyed) {
      for (const locale of ['pt-PT', 'en-US'] as AppLocale[]) expect(translateMessage(locale, key, '∅')).not.toBe('∅');
      for (const bundle of [esES, frFR, deDE, itIT]) expect(bundle[key], key).toBeTruthy();
    }
  });

  it('leaves no Portuguese literal in the portal components', () => {
    for (const file of files) {
      // 'Operações' is the default category saved with a new link (data, not a label), so it stays.
      const source = readFileSync(join(__dirname, file), 'utf8').replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, '').replaceAll("'Operações'", '');
      expect(source, file).not.toMatch(/[áàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]/);
      expect(source, file).not.toMatch(/\b(Atualizar|Remover|Editar|Guardar|Fechar|Parar|Nome|Ordem|Ativa|Tempo|Resultado)\b/);
    }
  });
});
