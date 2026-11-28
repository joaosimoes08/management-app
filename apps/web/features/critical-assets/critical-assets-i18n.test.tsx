import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translateMessage, type AppLocale } from '@/lib/i18n/i18n';
import { translateSourceText } from '@/lib/i18n/source-text-messages';
import { messages as deDE } from '@/lib/i18n/messages/critical-assets/de-DE';
import { messages as esES } from '@/lib/i18n/messages/critical-assets/es-ES';
import { messages as frFR } from '@/lib/i18n/messages/critical-assets/fr-FR';
import { messages as itIT } from '@/lib/i18n/messages/critical-assets/it-IT';

// The critical-assets screens moved from hard-coded Portuguese (translated on the page from
// source-text-messages.ts) to keyed messages. Each key must render exactly what the old Portuguese
// source showed, and en-US exactly what the source-text table made of it.
const keyed: Array<[key: string, portuguese: string, params?: Record<string, string | number>]> = [
  ['criticalAssets.page.title', 'Ativos críticos'],
  ['criticalAssets.page.description', 'Revisão semanal dos dados de inventário dos ativos críticos do Site.'],
  ['criticalAssets.page.searchPlaceholder', 'Pesquisar nome, hostname, IP, série ou etiqueta…'],
  ['criticalAssets.page.searchLabel', 'Pesquisar ativos críticos'],
  ['criticalAssets.page.loadError', 'Não foi possível carregar os ativos críticos.'],
  ['criticalAssets.dueState.overdue', 'Em atraso'],
  ['criticalAssets.dueState.due_this_week', 'Para esta semana'],
  ['criticalAssets.dueState.up_to_date', 'Em dia'],
  ['criticalAssets.dueState.unscheduled', 'Sem agendamento'],
  ['criticalAssets.due.next', 'Próximo prazo'],
  ['criticalAssets.due.pendingNoOwner', '3 pendentes, sem responsável', { count: 3 }],
  ['criticalAssets.due.pendingWeeks', '3 semanas pendentes', { count: 3 }],
  ['criticalAssets.outcome.confirmed', 'Confirmado'],
  ['criticalAssets.outcome.needsCorrection', 'Correção pedida'],
  ['criticalAssets.outcome.notFound', 'Não encontrado'],
  ['criticalAssets.outcome.pending', 'Pendente'],
  ['criticalAssets.noOwner', 'Sem responsável'],
  ['criticalAssets.noReview', 'Sem revisão'],
  ['criticalAssets.cancel', 'Cancelar'],
  ['criticalAssets.close', 'Fechar'],
  ['criticalAssets.saving', 'A guardar…'],
  ['criticalAssets.column.asset', 'Equipamento'],
  ['criticalAssets.column.type', 'Tipo'],
  ['criticalAssets.column.owner', 'Grupo responsável'],
  ['criticalAssets.column.outcome', 'Último resultado'],
  ['criticalAssets.column.due', 'Prazo'],
  ['criticalAssets.column.status', 'Estado'],
  ['criticalAssets.column.week', 'Semana'],
  ['criticalAssets.column.actions', 'Ações'],
  ['criticalAssets.column.managementIp', 'IP de gestão'],
  ['criticalAssets.column.serialNumber', 'Número de série'],
  ['criticalAssets.column.assetTag', 'Etiqueta'],
  ['criticalAssets.column.tier', 'Criticidade'],
  ['criticalAssets.csv.outcomeDate', 'Data do último resultado'],
  ['criticalAssets.csv.reviewer', 'Revisor'],
  ['criticalAssets.csv.dueDate', 'Data do prazo'],
  ['criticalAssets.csv.pendingReviews', 'Revisões pendentes'],
  ['criticalAssets.csv.requestedAt', 'Pedido em'],
  ['criticalAssets.csv.closedAt', 'Fechada em'],
  ['criticalAssets.csv.reference', 'Referência ou nota'],
  ['criticalAssets.csv.reviews', 'Revisões'],
  ['criticalAssets.csv.onTime', 'Revistas a tempo'],
  ['criticalAssets.csv.percent', 'Percentagem'],
  ['criticalAssets.row.openHistory', 'Abrir histórico de Core switch', { name: 'Core switch' }],
  ['criticalAssets.row.confirm', 'Confirmar'],
  ['criticalAssets.row.requestCorrection', 'Pedir correção'],
  ['criticalAssets.row.assignOwnerTo', 'Atribuir responsável a Core switch', { name: 'Core switch' }],
  ['criticalAssets.row.select', 'Selecionar ativo Core switch', { name: 'Core switch' }],
  ['criticalAssets.row.notSelectable', 'Core switch sem revisão pendente', { name: 'Core switch' }],
  ['criticalAssets.row.selectAll', 'Selecionar todos os ativos com revisão pendente'],
  ['criticalAssets.tier.count.T1', 'Tier 1 · Vital'],
  ['criticalAssets.tier.count.T2', 'Tier 2 · Importante'],
  ['criticalAssets.tier.count.T3', 'Tier 3 · Padrão'],
  ['criticalAssets.tier.option.T1', 'T1 · Vital'],
  ['criticalAssets.tier.option.T2', 'T2 · Importante'],
  ['criticalAssets.tier.option.T3', 'T3 · Padrão'],
  ['criticalAssets.filter.type', 'Filtrar por tipo'],
  ['criticalAssets.filter.ownerLabel', 'Responsável'],
  ['criticalAssets.filter.owner', 'Filtrar por grupo responsável'],
  ['criticalAssets.filter.outcome', 'Filtrar por último resultado'],
  ['criticalAssets.filter.due', 'Filtrar por prazo'],
  ['criticalAssets.filter.tier', 'Filtrar por criticidade'],
  ['criticalAssets.filter.clear', 'Limpar filtros'],
  ['criticalAssets.toolbar.owners', 'Responsáveis'],
  ['criticalAssets.toolbar.confirmSelected', 'Confirmar selecionados (3)', { count: 3 }],
  ['criticalAssets.views.label', 'Vista'],
  ['criticalAssets.views.assets', 'Ativos'],
  ['criticalAssets.views.corrections', 'Correções (3)', { count: 3 }],
  ['criticalAssets.views.compliance', 'Conformidade'],
  ['criticalAssets.counts.label', 'Resumo e filtros rápidos'],
  ['criticalAssets.counts.filtered', '2 de 7 ativos', { shown: 2, total: 7 }],
  ['criticalAssets.counts.all', '3 ativos críticos', { count: 3 }],
  ['criticalAssets.selectingAll', 'A selecionar…'],
  ['criticalAssets.empty.filteredTitle', 'Sem ativos correspondentes'],
  ['criticalAssets.empty.title', 'Ainda não existem ativos críticos'],
  ['criticalAssets.empty.filteredText', 'Muda a pesquisa ou limpa os filtros.'],
  ['criticalAssets.empty.text', 'Marca equipamentos como críticos no inventário para os rever aqui.'],
  ['criticalAssets.pagination.label', 'Paginação de ativos'],
  ['criticalAssets.corrections.label', 'Correções'],
  ['criticalAssets.corrections.tabsLabel', 'Estado das correções'],
  ['criticalAssets.corrections.open', 'Abertas'],
  ['criticalAssets.corrections.closed', 'Fechadas'],
  ['criticalAssets.corrections.loadError', 'Não foi possível carregar as correções.'],
  ['criticalAssets.corrections.emptyOpen', 'Sem correções abertas'],
  ['criticalAssets.corrections.emptyClosed', 'Sem correções fechadas'],
  ['criticalAssets.corrections.emptyText', 'As correções pedidas nas revisões aparecem aqui.'],
  ['criticalAssets.corrections.request', 'Pedido de correção'],
  ['criticalAssets.corrections.status.OPEN', 'Aberta'],
  ['criticalAssets.corrections.status.RESOLVED', 'Resolvida'],
  ['criticalAssets.corrections.status.REJECTED', 'Rejeitada'],
  ['criticalAssets.corrections.resolve', 'Resolver'],
  ['criticalAssets.corrections.reject', 'Rejeitar'],
  ['criticalAssets.compliance.emptyTitle', 'Sem revisões para medir'],
  ['criticalAssets.compliance.emptyText', 'A conformidade aparece quando existirem revisões semanais.'],
  ['criticalAssets.detail.historyOf', 'Histórico de Core switch', { name: 'Core switch' }],
  ['criticalAssets.detail.due', 'Prazo:'],
  ['criticalAssets.detail.outcome', 'Último resultado:'],
  ['criticalAssets.detail.pending', 'Pendentes:'],
  ['criticalAssets.detail.openDevice', 'Abrir equipamento'],
  ['criticalAssets.detail.changeOwner', 'Alterar responsável'],
  ['criticalAssets.detail.dependencies', 'Dependências'],
  ['criticalAssets.detail.linksTo', 'Liga a'],
  ['criticalAssets.detail.linksFrom', 'Liga de'],
  ['criticalAssets.detail.noDependencies', 'Sem ligações registadas para este equipamento.'],
  ['criticalAssets.detail.reviewHistory', 'Histórico de revisões (3)', { count: 3 }],
  ['criticalAssets.detail.noReviews', 'Ainda não existem revisões para este ativo.'],
  ['criticalAssets.detail.linkedReview', 'Revisão ligada à notificação'],
  ['criticalAssets.detail.unknownReviewer', 'Revisor desconhecido'],
  ['criticalAssets.notice.confirmed', 'Core switch: confirmação registada.', { name: 'Core switch' }],
  ['criticalAssets.notice.correctionRequested', 'Core switch: pedido de correção registado.', { name: 'Core switch' }],
  ['criticalAssets.notice.ownerSaved', 'Responsável por SWITCH guardado.', { type: 'SWITCH' }],
  ['criticalAssets.error.record', 'Não foi possível registar a revisão.'],
  ['criticalAssets.error.selectAll', 'Não foi possível selecionar os ativos correspondentes.'],
  ['criticalAssets.error.bulk', 'Não foi possível registar as revisões.'],
  ['criticalAssets.error.closeCorrection', 'Não foi possível fechar a correção.'],
  ['criticalAssets.error.save', 'Não foi possível guardar.'],
  ['criticalAssets.review.title', 'Confirmar revisão de Core switch', { name: 'Core switch' }],
  ['criticalAssets.review.description', 'Semana de 16/11/2026. Confirma nome, tipo, hostname, IP de gestão, número de série, etiqueta e estado. Nada é alterado automaticamente no inventário.', { date: '16/11/2026' }],
  ['criticalAssets.review.notes', 'Notas (opcional)'],
  ['criticalAssets.review.submit', 'Registar confirmação'],
  ['criticalAssets.request.title', 'Pedir correção de Core switch', { name: 'Core switch' }],
  ['criticalAssets.request.required', 'Indica os dados a corrigir.'],
  ['criticalAssets.request.label', 'Dados a corrigir (obrigatório)'],
  ['criticalAssets.request.submit', 'Registar pedido de correção'],
  ['criticalAssets.bulk.title', 'Confirmar selecionados'],
  ['criticalAssets.bulk.tableLabel', 'Revisões a confirmar'],
  ['criticalAssets.bulk.state.recorded', 'Registado'],
  ['criticalAssets.bulk.state.already', 'Já registado'],
  ['criticalAssets.bulk.state.failed', 'Falha ao registar'],
  ['criticalAssets.bulk.running', 'A registar…'],
  ['criticalAssets.bulk.pending', 'Por registar'],
  ['criticalAssets.bulk.confirm', 'Confirmar 3 revisões', { count: 3 }],
  ['criticalAssets.bulk.noResponse', 'Sem resposta para esta revisão.'],
  ['criticalAssets.owner.assign', 'Atribuir responsável'],
  ['criticalAssets.owner.description', 'O grupo fica responsável pela revisão semanal de todos os ativos críticos deste tipo no Site.'],
  ['criticalAssets.owner.assetType', 'Tipo de ativo'],
  ['criticalAssets.owner.selectGroup', 'Seleciona um grupo'],
  ['criticalAssets.owner.timezone', 'Fuso horário do Site'],
  ['criticalAssets.owner.save', 'Guardar responsável'],
  ['criticalAssets.closeCorrection.changeRequired', 'Indica a alteração feita (ligação ou referência).'],
  ['criticalAssets.closeCorrection.reasonRequired', 'Indica o motivo da rejeição.'],
  ['criticalAssets.closeCorrection.request', 'Pedido: Serial errado', { description: 'Serial errado' }],
  ['criticalAssets.closeCorrection.changeLabel', 'Alteração feita (ligação ou referência, obrigatório)'],
  ['criticalAssets.closeCorrection.reasonLabel', 'Motivo da rejeição (obrigatório)'],
  ['criticalAssets.closeCorrection.resolve', 'Marcar como resolvida'],
  ['criticalAssets.closeCorrection.reject', 'Rejeitar correção'],
];

// These showed Portuguese in English before (the source-text table had no entry): they now have a real translation.
const untranslatedBefore = new Set(['criticalAssets.views.corrections', 'criticalAssets.detail.linksTo', 'criticalAssets.closeCorrection.request', 'criticalAssets.closeCorrection.resolve']);
const sourceFiles = ['critical-assets-page.tsx', 'critical-assets-dialogs.tsx', 'workbench.ts'];
const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

describe('critical assets keyed messages', () => {
  it.each(keyed)('%s renders the same Portuguese and English as before', (key, portuguese, params) => {
    expect(translateMessage('pt-PT', key, undefined, params)).toBe(portuguese);
    const english = translateMessage('en-US', key, undefined, params);
    if (untranslatedBefore.has(key)) {
      expect(english).toBeTruthy();
      expect(english).not.toBe(portuguese);
    } else {
      expect(english).toBe(translateSourceText('en-US', portuguese));
    }
  });

  it('covers every key the critical-assets screens use, in both locales and the added languages', () => {
    const source = sourceFiles.map(read).join('\n');
    const used = new Set([...source.matchAll(/'(criticalAssets\.[\w.]+)'/g)].map((match) => match[1]));
    // Keys built from a value: due states, bulk result states and correction statuses.
    const prefixes = [...source.matchAll(/`(criticalAssets\.[\w.]+\.)\$\{/g)].map((match) => match[1]);
    expect(prefixes.sort()).toEqual(['criticalAssets.bulk.state.', 'criticalAssets.corrections.status.', 'criticalAssets.dueState.']);
    for (const [key] of keyed) if (prefixes.some((prefix) => key.startsWith(prefix))) used.add(key);
    expect([...used].sort()).toEqual(keyed.map(([key]) => key).sort());
    for (const [key] of keyed) {
      for (const locale of ['pt-PT', 'en-US'] as AppLocale[]) expect(translateMessage(locale, key, '∅')).not.toBe('∅');
      for (const bundle of [esES, frFR, deDE, itIT]) expect(bundle[key], key).toBeTruthy();
    }
  });

  it.each(sourceFiles)('leaves no Portuguese literal in %s', (file) => {
    const source = read(file).replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).not.toMatch(/[áàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]/);
  });
});

const locale = vi.hoisted(() => ({ current: 'en-US' as 'pt-PT' | 'en-US' }));
vi.mock('@/lib/i18n/i18n', async (original) => {
  const actual = await original<typeof import('@/lib/i18n/i18n')>();
  return {
    ...actual,
    useOptionalI18n: () => ({ t: (key: string, fallback?: string, params?: Record<string, string | number>) => actual.translateMessage(locale.current, key, fallback, params) }),
  };
});
vi.mock('@/components/layout/app-shell', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/layout/app-shell')>(),
  PageShell: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => <><div>{actions}</div>{children}</>,
}));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1' }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: () => true }) }));
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ apiFetch }));

const { CriticalAssetsPage } = await import('./critical-assets-page');
const group = { id: 'group-1', name: 'Network Team' };
const core = { id: 'device-1', name: 'Core switch', type: 'SWITCH', hostname: 'core', managementIp: '192.0.2.1', serialNumber: 'SN-1', assetTag: 'AT-1', status: 'ACTIVE', owner: group, assignedGroup: group, dueState: 'overdue', dueDate: '2026-11-23T09:00:00.000Z', dueWeekStart: '2026-11-16', pendingCount: 1, overdueCount: 1, latestOutcome: 'CONFIRMED', latestConfirmedAt: '2026-11-10T10:00:00.000Z', attestations: [] };

const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CriticalAssetsPage /></QueryClientProvider>);

beforeEach(() => {
  window.history.replaceState(null, '', '/attestacao-ativos');
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes('/settings/access-groups')) return [group];
    if (url.includes('/critical-assets/corrections')) return { items: [] };
    if (url.includes('/critical-assets/assets')) return { timezone: 'Europe/Lisbon', total: 1, page: 1, pageSize: 50, items: [core] };
    return { timezone: 'Europe/Lisbon', mappings: [{ id: 'm-1', assetType: 'SWITCH', group }], assets: [core], unassigned: [] };
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); locale.current = 'en-US'; });

describe('critical assets page follows the active language', () => {
  it('renders the workbench in English', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Open history of Core switch' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: translateSourceText('en-US', 'Ativos críticos') })).toBeTruthy();
    expect(screen.getAllByText(translateSourceText('en-US', 'Em atraso')).length).toBeGreaterThan(0);
    expect(screen.getByRole('columnheader', { name: translateSourceText('en-US', 'Grupo responsável') })).toBeTruthy();
    expect(screen.queryByText('Ativos críticos')).toBeNull();
  });

  it('renders the same workbench in Portuguese', async () => {
    locale.current = 'pt-PT';
    renderPage();
    expect(await screen.findByRole('button', { name: 'Abrir histórico de Core switch' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ativos críticos' })).toBeTruthy();
    expect(screen.getAllByText('Em atraso').length).toBeGreaterThan(0);
    expect(screen.getByRole('columnheader', { name: 'Grupo responsável' })).toBeTruthy();
  });
});
