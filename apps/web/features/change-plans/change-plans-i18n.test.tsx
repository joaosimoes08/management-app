import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateMessage, type AppLocale } from '@/lib/i18n/i18n';
import { translateSourceText } from '@/lib/i18n/source-text-messages';
import { messages as deDE } from '@/lib/i18n/messages/change-plans/de-DE';
import { messages as esES } from '@/lib/i18n/messages/change-plans/es-ES';
import { messages as frFR } from '@/lib/i18n/messages/change-plans/fr-FR';
import { messages as itIT } from '@/lib/i18n/messages/change-plans/it-IT';
import { messages as ptPT } from '@/lib/i18n/messages/change-plans/pt-PT';
import type { ChangeItem } from './api';
import { PlanImpactSection } from './plan-impact';

type Params = Record<string, string | number>;

// The Alterações screens moved from hard-coded Portuguese (translated on the page from source-text-messages.ts)
// to keyed messages. Each key must render exactly what the old Portuguese source showed, and en-US exactly
// what the source-text table made of it. The table gave real English for every string, so there are no
// fixed-English exceptions.
const keyed: Array<[key: string, portuguese: string]> = [
  ['changePlans.page.section', 'Alterações'],
  ['changePlans.page.loadFailed', 'Não foi possível carregar as alterações deste Site.'],
  ['changePlans.page.openFailed', 'Não foi possível abrir a alteração.'],
  ['changePlans.page.discardDraftTitle', 'Descartar rascunho'],
  ['changePlans.page.discardDraftMessage', 'As alterações a este rascunho ainda não foram guardadas. Descartar?'],
  ['changePlans.page.discard', 'Descartar'],
  ['changePlans.page.keepEditing', 'Continuar a editar'],
  ['changePlans.page.draftSaved', 'Rascunho guardado. Calcula a pré-visualização antes de submeter para revisão.'],
  ['changePlans.page.saveDraftFailed', 'Não foi possível guardar o rascunho.'],
  ['changePlans.page.changedDuringAnalysis', 'A alteração mudou durante a análise. Atualiza a alteração e calcula novamente.'],
  ['changePlans.page.calculateFailed', 'Não foi possível calcular o impacto.'],
  ['changePlans.page.submitted', 'Alteração submetida para revisão.'],
  ['changePlans.page.submitFailed', 'Não foi possível submeter a alteração.'],
  ['changePlans.page.approveChange', 'Aprovar alteração'],
  ['changePlans.page.approved', 'Alteração aprovada.'],
  ['changePlans.page.returned', 'Alteração devolvida para correção.'],
  ['changePlans.page.reviewFailed', 'Não foi possível registar a revisão.'],
  ['changePlans.page.cancelChange', 'Cancelar alteração'],
  ['changePlans.page.keep', 'Manter'],
  ['changePlans.page.cancelled', 'Alteração cancelada.'],
  ['changePlans.page.cancelFailed', 'Não foi possível cancelar a alteração.'],
  ['changePlans.page.columnChange', 'Alteração'],
  ['changePlans.page.columnStatus', 'Estado'],
  ['changePlans.page.plannedWindow', 'Janela planeada'],
  ['changePlans.page.targets', 'Alvos'],
  ['changePlans.page.columnOverlaps', 'Sobreposições'],
  ['changePlans.page.searchPlaceholder', 'Pesquisar título, motivo, operação ou alvo…'],
  ['changePlans.page.searchLabel', 'Pesquisar alterações'],
  ['changePlans.page.targetType', 'Tipo de alvo'],
  ['changePlans.page.filterByTargetType', 'Filtrar por tipo de alvo'],
  ['changePlans.page.from', 'De'],
  ['changePlans.page.windowFrom', 'Janela a partir de'],
  ['changePlans.page.to', 'Até'],
  ['changePlans.page.windowTo', 'Janela até'],
  ['changePlans.page.clearFilters', 'Limpar filtros'],
  ['changePlans.page.list', 'Lista'],
  ['changePlans.page.calendar', 'Calendário'],
  ['changePlans.page.refresh', 'Atualizar'],
  ['changePlans.page.createChangeButton', '＋ Criar alteração'],
  ['changePlans.page.calculatingPreview', 'A calcular a pré-visualização…'],
  ['changePlans.page.previewUpdated', 'Pré-visualização atualizada. Revê os impactos e a cobertura antes de submeter.'],
  ['changePlans.page.heading', 'Alterações Planeadas'],
  ['changePlans.page.selectSite', 'Seleciona um Site na barra lateral para ver ou criar alterações.'],
  ['changePlans.page.filterByStatus', 'Filtrar por estado'],
  ['changePlans.page.overlapsCheckFailed', 'Não foi possível verificar as sobreposições.'],
  ['changePlans.page.overlapsPartial', 'As sobreposições só cobrem parte do intervalo.'],
  ['changePlans.page.tableLabel', 'Alterações planeadas'],
  ['changePlans.page.noMatches', 'Nenhuma alteração corresponde à pesquisa ou aos filtros.'],
  ['changePlans.page.noChanges', 'Ainda não há alterações registadas neste Site.'],
  ['changePlans.page.editChange', 'Editar alteração'],
  ['changePlans.page.createChange', 'Criar alteração'],
  ['changePlans.page.close', 'Fechar'],
  ['changePlans.page.readOnlyNote', 'A pré-visualização é somente de leitura. A alteração não modifica equipamentos nem reserva recursos.'],
  ['changePlans.page.title', 'Título'],
  ['changePlans.page.titlePlaceholder', 'Ex.: Atualização do switch central'],
  ['changePlans.page.reason', 'Motivo'],
  ['changePlans.page.reasonPlaceholder', 'Explica o objetivo e a necessidade da alteração'],
  ['changePlans.page.plannedStart', 'Início planeado'],
  ['changePlans.page.plannedEnd', 'Fim planeado'],
  ['changePlans.page.targetsAndOperation', 'Alvos e operação proposta'],
  ['changePlans.page.type', 'Tipo'],
  ['changePlans.page.selectType', 'Seleciona um tipo'],
  ['changePlans.page.searchTarget', 'Pesquisar alvo'],
  ['changePlans.page.searchTargetPlaceholder', 'Nome, endereço ou número de VLAN'],
  ['changePlans.page.target', 'Alvo'],
  ['changePlans.page.selectTarget', 'Seleciona um alvo'],
  ['changePlans.page.proposedOperation', 'Operação proposta'],
  ['changePlans.page.operationPlaceholder', 'Ex.: Atualizar firmware para 9.4.2'],
  ['changePlans.page.currentValue', 'Valor atual (opcional)'],
  ['changePlans.page.currentValuePlaceholder', 'Ex.: versão 9.3.7'],
  ['changePlans.page.proposedValue', 'Valor proposto (opcional)'],
  ['changePlans.page.proposedValuePlaceholder', 'Ex.: versão 9.4.2'],
  ['changePlans.page.addTarget', 'Adicionar alvo'],
  ['changePlans.page.targetsLimited', 'A lista de alvos foi limitada. Pesquisa pelo nome ou endereço para encontrar outros alvos.'],
  ['changePlans.page.noTargetMatches', 'Nenhum alvo deste tipo corresponde à pesquisa.'],
  ['changePlans.page.remove', 'Remover'],
  ['changePlans.page.addAtLeastOneTarget', 'Adiciona pelo menos um equipamento, interface, VLAN, subnet, IP, Host ou serviço.'],
  ['changePlans.page.saving', 'A guardar…'],
  ['changePlans.page.saveDraft', 'Guardar rascunho'],
  ['changePlans.page.allChanges', '← Todas as alterações'],
  ['changePlans.page.selectedSite', 'Site selecionado'],
  ['changePlans.page.preview', 'Pré-visualização'],
  ['changePlans.page.calculating', 'A calcular…'],
  ['changePlans.page.notCalculated', 'Por calcular'],
  ['changePlans.page.windowOverlaps', 'A janela sobrepõe-se a outras alterações ou manutenções deste Site'],
  ['changePlans.page.maintenancePrefix', 'Manutenção: '],
  ['changePlans.page.detailOverlapsFailed', 'Não foi possível verificar as sobreposições desta alteração.'],
  ['changePlans.page.knownImpact', 'Impacto conhecido'],
  ['changePlans.page.partialCoverage', 'Cobertura parcial'],
  ['changePlans.page.analysisComplete', 'Análise concluída'],
  ['changePlans.page.knownImpacts', 'Impactos conhecidos'],
  ['changePlans.page.staleData', 'Dados antigos (>24 h)'],
  ['changePlans.page.inventoryUpdate', 'Atualização do inventário'],
  ['changePlans.page.noRecord', 'Sem registo'],
  ['changePlans.page.noRelationsFound', 'Não foram encontradas relações registadas.'],
  ['changePlans.page.notZeroImpact', 'Este resultado não confirma impacto zero.'],
  ['changePlans.page.observedOver24h', 'Observação com mais de 24 h'],
  ['changePlans.page.updateUnknown', 'Atualização desconhecida'],
  ['changePlans.page.observedLast24h', 'Observado nas últimas 24 h'],
  ['changePlans.page.lowConfidence', ' · confiança baixa (SNMP)'],
  ['changePlans.page.maintenanceOverlap', 'Sobreposição com manutenção existente'],
  ['changePlans.page.changeOverlap', 'Sobreposição com alterações submetidas, aprovadas ou em curso'],
  ['changePlans.page.reviewNoteLabel', 'Nota de revisão:'],
  ['changePlans.page.editDraft', 'Editar rascunho'],
  ['changePlans.page.recalculatePreview', 'Recalcular pré-visualização'],
  ['changePlans.page.saveCompletePreview', 'Guarda uma pré-visualização completa e atual antes de submeter.'],
  ['changePlans.page.submitForReview', 'Submeter para revisão'],
  ['changePlans.page.duplicatePlan', 'Duplicar plano'],
  ['changePlans.page.adminReview', 'Revisão administrativa'],
  ['changePlans.page.reviewNote', 'Nota de revisão'],
  ['changePlans.page.reviewNotePlaceholder', 'Obrigatória para devolver para correção'],
  ['changePlans.page.returnForCorrection', 'Devolver para correção'],
  ['changePlans.page.activity', 'Atividade'],
  ['changePlans.page.note', 'Nota'],
  ['changePlans.page.noActivity', 'Ainda não há atividade registada para esta alteração.'],
  ['changePlans.page.activityFailed', 'Não foi possível carregar a atividade desta alteração.'],
  ['changePlans.execution.conflictWarnings', 'Avisos de conflito'],
  ['changePlans.execution.warningsBeforeImplementing', 'Avisos antes de implementar'],
  ['changePlans.execution.nonBlocking', 'Não bloqueiam a alteração.'],
  ['changePlans.execution.noMaintenanceWindows', 'Este Site não tem janelas de manutenção nesse período.'],
  ['changePlans.execution.result', 'Resultado'],
  ['changePlans.execution.checkedAt', 'Verificado em'],
  ['changePlans.execution.field', 'Campo'],
  ['changePlans.execution.before', 'Antes'],
  ['changePlans.execution.planned', 'Planeado'],
  ['changePlans.execution.current', 'Atual'],
  ['changePlans.execution.notComparable', 'Este alvo não tem valores propostos que possam ser comparados com o inventário.'],
  ['changePlans.execution.noTargets', 'Não há alvos para comparar.'],
  ['changePlans.execution.addStepsFailed', 'Não foi possível adicionar os passos.'],
  ['changePlans.execution.updateStepFailed', 'Não foi possível atualizar o passo.'],
  ['changePlans.execution.removeStepFailed', 'Não foi possível remover o passo.'],
  ['changePlans.execution.startImplementation', 'Iniciar implementação'],
  ['changePlans.execution.startFailed', 'Não foi possível iniciar a implementação.'],
  ['changePlans.execution.closeChange', 'Encerrar alteração'],
  ['changePlans.execution.closeFailed', 'Não foi possível encerrar a alteração.'],
  ['changePlans.execution.implementation', 'Implementação'],
  ['changePlans.execution.conflictsFailed', 'Não foi possível verificar os avisos de conflito.'],
  ['changePlans.execution.implementationStarted', 'Implementação iniciada'],
  ['changePlans.execution.closed', 'Encerrada'],
  ['changePlans.execution.closingNoteLabel', 'Nota de encerramento:'],
  ['changePlans.execution.checklist', 'Lista de implementação'],
  ['changePlans.execution.noSteps', 'Ainda não há passos definidos para esta alteração.'],
  ['changePlans.execution.toDo', 'Por concluir'],
  ['changePlans.execution.stepsDuringImplementation', 'Os passos marcam-se durante a implementação.'],
  ['changePlans.execution.remove', 'Remover'],
  ['changePlans.execution.newSteps', 'Novos passos (um por linha)'],
  ['changePlans.execution.newStepsPlaceholder', 'Ex.: Guardar a configuração atual\nAtualizar firmware\nConfirmar ligações'],
  ['changePlans.execution.addSteps', 'Adicionar passos'],
  ['changePlans.execution.failedNotePlaceholder', 'Explica o que falhou ou porque foi revertida'],
  ['changePlans.execution.notesPlaceholder', 'Notas sobre a implementação'],
  ['changePlans.execution.closingNoteNeeded', 'Indica uma nota de encerramento.'],
  ['changePlans.execution.postChangeCheck', 'Verificação pós-alteração'],
  ['changePlans.execution.postChangeCheckDescription', 'Compara os valores propostos de cada alvo com o inventário atual.'],
  ['changePlans.execution.checking', 'A verificar…'],
  ['changePlans.execution.checkAgain', 'Verificar novamente'],
  ['changePlans.execution.checkNow', 'Verificar agora'],
  ['changePlans.execution.checkFailed', 'Não foi possível fazer a verificação pós-alteração.'],
  ['changePlans.execution.snmpWrites', 'Escritas SNMP associadas'],
  ['changePlans.monthView.overlapsFailed', 'Não foi possível verificar as sobreposições.'],
  ['changePlans.monthView.noOverlaps', 'Sem janelas sobrepostas neste mês.'],
  ['changePlans.monthView.previousMonth', 'Mês anterior'],
  ['changePlans.monthView.today', 'Hoje'],
  ['changePlans.monthView.nextMonth', 'Mês seguinte'],
  ['changePlans.monthView.legend', 'Legenda do calendário'],
  ['changePlans.monthView.maintenance', 'Manutenção'],
  ['changePlans.monthView.cancelledNote', 'As canceladas aparecem no separador Canceladas.'],
  ['changePlans.monthView.calendarLabel', 'Calendário de alterações'],
  ['changePlans.monthView.overlap', 'Sobreposição'],
  ['changePlans.planImpact.heading', 'Impacto se o equipamento for abaixo'],
  ['changePlans.planImpact.hide', 'Ocultar impacto'],
  ['changePlans.planImpact.show', 'Ver impacto'],
  ['changePlans.planImpact.device', 'Equipamento'],
];

/** Every non-test source file of the Alterações feature folder. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}
const sources = sourceFiles(__dirname).map((path) => readFileSync(path, 'utf8'));

// Keys added by this move; the older changePlans.status/type/close/... keys were already keyed in i18n.tsx.
const movedKey = /'(changePlans\.(?:page|execution|monthView|planImpact)\.[\w.]+)'/g;

describe('change-plans keyed messages', () => {
  it.each(keyed)('%s renders the same Portuguese and English as before', (key, portuguese) => {
    expect(translateMessage('pt-PT', key)).toBe(portuguese);
    expect(translateMessage('en-US', key)).toBe(translateSourceText('en-US', portuguese));
  });

  it('covers every key the Alterações components use, in both locales and the added languages', () => {
    const used = new Set(sources.flatMap((source) => [...source.matchAll(movedKey)].map((match) => match[1])));
    const listed = new Set(keyed.map(([key]) => key));
    expect([...used].sort()).toEqual([...listed].sort());
    expect(Object.keys(ptPT).sort()).toEqual([...listed].sort());
    for (const key of listed) {
      for (const locale of ['pt-PT', 'en-US'] as AppLocale[]) expect(translateMessage(locale, key, '∅')).not.toBe('∅');
      for (const bundle of [esES, frFR, deDE, itIT]) expect(bundle[key as keyof typeof bundle], key).toBeTruthy();
    }
  });

  it('keeps every status, type and activity label keyed now that the Portuguese fallback maps are gone', () => {
    const groups: Record<string, string[]> = {
      status: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK'],
      statusTab: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK'],
      type: ['DEVICE', 'INTERFACE', 'VLAN', 'SUBNET', 'IP_ADDRESS', 'HOST', 'SERVICE'],
      close: ['COMPLETED', 'FAILED', 'ROLLED_BACK'],
      check: ['AS_PLANNED', 'DIFFERENT', 'NOT_COMPARABLE', 'TARGET_MISSING'],
      warning: ['OUTSIDE_MAINTENANCE_WINDOW', 'TIER1_CRITICAL_ASSET', 'CRITICAL_ASSET', 'OVERLAPS_APPROVED_CHANGE'],
      activity: ['CHANGE_PLAN_CREATED', 'CHANGE_PLAN_UPDATED', 'CHANGE_PLAN_IMPACT_PREVIEWED', 'CHANGE_PLAN_SUBMITTED', 'CHANGE_PLAN_APPROVED', 'CHANGE_PLAN_REJECTED', 'CHANGE_PLAN_CANCELLED', 'CHANGE_PLAN_STARTED', 'CHANGE_PLAN_COMPLETED', 'CHANGE_PLAN_FAILED', 'CHANGE_PLAN_ROLLED_BACK', 'CHANGE_PLAN_CHECKLIST_ADDED', 'CHANGE_PLAN_CHECKLIST_TICKED', 'CHANGE_PLAN_CHECKLIST_UNTICKED', 'CHANGE_PLAN_CHECKLIST_REMOVED', 'CHANGE_PLAN_SNMP_WRITE_LINKED', 'CHANGE_PLAN_SNMP_WRITE_UNLINKED'],
    };
    for (const [group, codes] of Object.entries(groups)) {
      for (const code of codes) {
        for (const locale of ['pt-PT', 'en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT'] as AppLocale[]) expect(translateMessage(locale, `changePlans.${group}.${code}`, '∅'), `${locale} ${group}.${code}`).not.toBe('∅');
      }
    }
  });

  it('leaves no Portuguese literal in the Alterações components', () => {
    for (const source of sources) expect(source.replace(/\/\*\*?[\s\S]*?\*\/|\/\/.*$/gm, '')).not.toMatch(/[áàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]/);
  });
});

const locale = vi.hoisted(() => ({ current: 'en-US' as 'pt-PT' | 'en-US' }));
vi.mock('@/lib/i18n/i18n', async (original) => {
  const actual = await original<typeof import('@/lib/i18n/i18n')>();
  return {
    ...actual,
    useOptionalI18n: () => ({ t: (key: string, fallback?: string, params?: Params) => actual.translateMessage(locale.current, key, fallback, params) }),
  };
});

afterEach(() => { cleanup(); locale.current = 'en-US'; });

const items = [{ entityType: 'DEVICE', entityId: 'd1' }] as ChangeItem[];

describe('Alterações screens follow the active language', () => {
  it('renders the plan impact section in English and in Portuguese', () => {
    render(<PlanImpactSection items={items} label={() => 'core-sw'} />);
    expect(screen.getByText('Impact if the device goes down')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show impact' })).toBeTruthy();
    cleanup();
    locale.current = 'pt-PT';
    render(<PlanImpactSection items={items} label={() => 'core-sw'} />);
    expect(screen.getByText('Impacto se o equipamento for abaixo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ver impacto' })).toBeTruthy();
  });
});
