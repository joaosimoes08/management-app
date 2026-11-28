import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateMessage, type AppLocale } from '@/lib/i18n/i18n';
import { translateSourceText } from '@/lib/i18n/source-text-messages';
import { messages as deDE } from '@/lib/i18n/messages/operations/de-DE';
import { messages as esES } from '@/lib/i18n/messages/operations/es-ES';
import { messages as frFR } from '@/lib/i18n/messages/operations/fr-FR';
import { messages as itIT } from '@/lib/i18n/messages/operations/it-IT';

// The operations screens (alerts, maintenance windows, inventory quality) moved from hard-coded
// Portuguese (translated on the page from source-text-messages.ts) to keyed messages. Each key must
// render exactly what the old Portuguese source showed, and en-US exactly what the source-text table made of it.
const keyed: Array<[key: string, portuguese: string, params?: Record<string, string | number>]> = [
  ['operations.alerts.acknowledge', 'Reconhecer'],
  ['operations.alerts.acknowledgeNamed', 'Reconhecer core-sw-01', { title: 'core-sw-01' }],
  ['operations.alerts.snoozeNamed', 'Adiar core-sw-01', { title: 'core-sw-01' }],
  ['operations.alerts.resolve', 'Resolver'],
  ['operations.alerts.resolveNamed', 'Resolver core-sw-01', { title: 'core-sw-01' }],
  ['operations.alerts.resolveTitle', 'Resolver alertas'],
  ['operations.alerts.until', 'até 23/11/2026, 15:00', { date: '23/11/2026, 15:00' }],
  ['operations.alerts.allSites', 'Todos os Sites'],
  ['operations.alerts.deviceRemoved', 'Equipamento removido'],
  ['operations.alerts.active', 'Alertas ativos'],
  ['operations.alerts.empty', 'Sem alertas ativos.'],
  ['operations.alerts.loadError', 'Não foi possível carregar os alertas.'],
  ['operations.alerts.failure.NOT_FOUND', 'Alerta não encontrado ou sem acesso.'],
  ['operations.alerts.failure.FORBIDDEN', 'Sem permissão para alterar este alerta.'],
  ['operations.alerts.failure.INVALID', 'Pedido inválido.'],
  ['operations.alerts.failure.ERROR', 'Erro inesperado.'],
  ['operations.alerts.done.ACKNOWLEDGE.one', '1 alerta reconhecido', { count: 1 }],
  ['operations.alerts.done.ACKNOWLEDGE.other', '37 alertas reconhecidos', { count: 37 }],
  ['operations.alerts.done.SNOOZE.one', '1 alerta adiado', { count: 1 }],
  ['operations.alerts.done.SNOOZE.other', '37 alertas adiados', { count: 37 }],
  ['operations.alerts.done.RESOLVE.one', '1 alerta resolvido', { count: 1 }],
  ['operations.alerts.done.RESOLVE.other', '37 alertas resolvidos', { count: 37 }],
  ['operations.alerts.failed.one', '1 falhou: B (X)', { count: 1, failures: 'B (X)' }],
  ['operations.alerts.failed.other', '37 falharam: B (X)', { count: 37, failures: 'B (X)' }],
  ['operations.alerts.actionError', 'Não foi possível aplicar a ação.'],
  ['operations.alerts.closeMessage', 'Fechar mensagem'],
  ['operations.alerts.snoozePlaceholder', 'Adiar…'],
  ['operations.alerts.bulk.region', 'Ações sobre os alertas selecionados'],
  ['operations.alerts.bulk.selected.one', '1 alerta selecionado', { count: 1 }],
  ['operations.alerts.bulk.selected.other', '37 alertas selecionados', { count: 37 }],
  ['operations.alerts.bulk.snooze', 'Adiar selecionados'],
  ['operations.alerts.bulk.clear', 'Limpar seleção'],
  ['operations.alerts.readOnly', 'Tens acesso só de leitura: reconhecer, adiar e resolver alertas cabe aos operadores (ADMIN, NETWORK_OPERATOR ou SYSTEMS_OPERATOR).'],
  ['operations.alerts.history.OPERATIONAL_ALERT_ACKNOWLEDGED', 'Reconhecido'],
  ['operations.alerts.history.OPERATIONAL_ALERT_SNOOZED', 'Adiado'],
  ['operations.alerts.history.OPERATIONAL_ALERT_RESOLVED', 'Resolvido'],
  ['operations.alerts.detail.loading', 'A carregar o alerta…'],
  ['operations.alerts.detail.loadError', 'Não foi possível carregar o alerta.'],
  ['operations.alerts.detail.nextStep', 'Próximo passo:'],
  ['operations.alerts.detail.open', 'Abrir'],
  ['operations.alerts.detail.firstSeen', 'Primeira ocorrência'],
  ['operations.alerts.detail.occurrences', 'Ocorrências'],
  ['operations.alerts.detail.acknowledged', 'Reconhecido'],
  ['operations.alerts.detail.resolved', 'Resolvido'],
  ['operations.alerts.detail.history', 'Histórico'],
  ['operations.alerts.detail.historyEmpty', 'Ainda ninguém agiu sobre este alerta.'],
  ['operations.alerts.detail.historyNote', 'Detalhe'],
  ['operations.alerts.field.severity', 'Severidade'],
  ['operations.alerts.field.alert', 'Alerta'],
  ['operations.alerts.field.device', 'Equipamento'],
  ['operations.alerts.field.source', 'Origem'],
  ['operations.alerts.field.site', 'Site'],
  ['operations.alerts.field.status', 'Estado'],
  ['operations.alerts.field.lastSeen', 'Última ocorrência'],
  ['operations.alerts.field.actions', 'Ações'],
  ['operations.alerts.status.OPEN', 'Aberto'],
  ['operations.alerts.status.ACKNOWLEDGED', 'Reconhecido'],
  ['operations.alerts.status.SNOOZED', 'Adiado'],
  ['operations.alerts.status.RESOLVED', 'Resolvido'],
  ['operations.severity.CRITICAL', 'Crítico'],
  ['operations.severity.HIGH', 'Alto'],
  ['operations.severity.MEDIUM', 'Médio'],
  ['operations.severity.WARNING', 'Aviso'],
  ['operations.severity.LOW', 'Baixo'],
  ['operations.severity.INFO', 'Info'],
  ['operations.severityMeaning.CRITICAL', 'Serviço em baixo ou em risco imediato. Atuar já.'],
  ['operations.severityMeaning.HIGH', 'Degradação com impacto provável. Tratar hoje.'],
  ['operations.severityMeaning.WARNING', 'Sinal a acompanhar, sem impacto imediato.'],
  ['operations.severityMeaning.INFO', 'Apenas informativo. Não requer ação.'],
  ['operations.severity.legendTitle', 'O que significa cada severidade?'],
  ['operations.alerts.source.SNMP_TRAP', 'Trap SNMP recebido'],
  ['operations.alerts.source.SNMP_TRAP_SOURCE', 'Traps SNMP não aceites'],
  ['operations.alerts.source.SNMP_INTERFACE', 'Estado de interface'],
  ['operations.alerts.source.SNMP_POLL', 'Recolha SNMP e equipamento inacessível'],
  ['operations.alerts.source.SNMP_DRIFT', 'Diferença de configuração'],
  ['operations.alerts.source.CAPACITY', 'Capacidade'],
  ['operations.alerts.source.DISCOVERY', 'Descoberta'],
  ['operations.alerts.source.INVENTORY_QUALITY', 'Qualidade do inventário'],
  ['operations.alerts.source.SYSTEM_HEALTH', 'Saúde do sistema'],
  ['operations.alerts.source.SNMP_HEALTH', 'Saúde do equipamento'],
  ['operations.alerts.kind.unreachable', 'Equipamento inacessível'],
  ['operations.alerts.nextStep.SNMP_TRAP', 'Abre o equipamento e confirma o evento que enviou.'],
  ['operations.alerts.nextStep.SNMP_TRAP_SOURCE', 'Confirma que o IP de origem é o IP de gestão de um equipamento e que a credencial TRAP (SNMPv3) e o Engine ID batem certo.'],
  ['operations.alerts.nextStep.SNMP_INTERFACE', 'Verifica a interface e a ligação física no equipamento.'],
  ['operations.alerts.nextStep.SNMP_POLL', 'Confirma que o equipamento responde a SNMP e que as credenciais estão certas.'],
  ['operations.alerts.nextStep.SNMP_DRIFT', 'Compara a configuração recolhida com o inventário e aceita ou corrige a diferença.'],
  ['operations.alerts.nextStep.CAPACITY', 'Revê a utilização e planeia a expansão antes de esgotar.'],
  ['operations.alerts.nextStep.DISCOVERY', 'Revê os resultados da descoberta e importa ou ignora o que foi encontrado.'],
  ['operations.alerts.nextStep.INVENTORY_QUALITY', 'Abre a fila de qualidade e corrige os dados em falta.'],
  ['operations.alerts.nextStep.SYSTEM_HEALTH', 'Verifica o estado dos serviços em Sistema.'],
  ['operations.alerts.nextStep.SNMP_HEALTH', 'Abre o equipamento e revê os valores de saúde SNMP (CPU, memória, temperatura, fontes e ventoinhas).'],
  ['operations.alerts.nextStep.default', 'Abre o alerta e revê o detalhe.'],
  ['operations.alerts.nextStep.unreachable', 'Confirma que o equipamento está ligado e alcançável a partir do servidor, e que a credencial SNMP está certa. Resolve-se sozinho no próximo poll com sucesso.'],
  ['operations.snooze.hours.one', '1 hora', { count: 1 }],
  ['operations.snooze.hours.other', '24 horas', { count: 24 }],
  ['operations.snooze.days.one', '1 dia', { count: 1 }],
  ['operations.snooze.days.other', '7 dias', { count: 7 }],
  ['operations.alerts.viewDetailNamed', 'Ver detalhe de core-sw-01', { title: 'core-sw-01' }],
  ['operations.alerts.selectNamed', 'Selecionar core-sw-01', { title: 'core-sw-01' }],
  ['operations.alerts.selectAll', 'Selecionar todos os alertas visíveis'],
  ['operations.alerts.filter.statusAria', 'Filtrar por estado'],
  ['operations.alerts.filter.unresolved', 'Por resolver'],
  ['operations.alerts.filter.scope', 'Âmbito'],
  ['operations.alerts.filter.scopeAria', 'Filtrar por âmbito'],
  ['operations.alerts.filter.activeSite', 'Site ativo'],
  ['operations.alerts.filter.clear', 'Limpar filtros'],
  ['operations.alerts.filter.allSeverities', 'Todas'],
  ['operations.alerts.list.defaultNote', 'Por omissão a lista mostra abertos, reconhecidos e adiados. Os adiados voltam a abrir no fim do prazo.'],
  ['operations.alerts.list.eventType', 'Tipo de evento:'],
  ['operations.alerts.list.removeSource', 'Remover'],
  ['operations.alerts.list.noMatch', 'Nenhum alerta corresponde aos filtros.'],
  ['operations.alerts.list.showing', 'A mostrar 100 de 237 alertas. Use os filtros para refinar.', { shown: 100, total: 237 }],
  ['operations.maintenance.title', 'Janelas ativas e próximas'],
  ['operations.maintenance.counts', '2 ativas · 5 nos próximos 14 dias', { active: 2, upcoming: 5, days: 14 }],
  ['operations.maintenance.criticalVisible', 'Alertas críticos continuam visíveis durante as janelas.'],
  ['operations.maintenance.loadError', 'Não foi possível carregar as janelas de manutenção.'],
  ['operations.maintenance.running', 'Em curso'],
  ['operations.maintenance.scheduled', 'Agendada'],
  ['operations.maintenance.empty', 'Sem janelas de manutenção ativas ou próximas.'],
  ['operations.config.loadError', 'Não foi possível carregar a configuração.'],
  ['operations.config.saveError', 'Não foi possível guardar.'],
  ['operations.config.ruleSaveError', 'Não foi possível guardar a regra.'],
  ['operations.config.windowSaveError', 'Não foi possível guardar a janela.'],
  ['operations.config.deleteRuleTitle', 'Eliminar regra'],
  ['operations.config.deleteRuleMessage', 'Eliminar a regra "Traps"? Os alertas deste tipo voltam a seguir as restantes regras.', { name: 'Traps' }],
  ['operations.config.delete', 'Eliminar'],
  ['operations.config.back', 'Voltar'],
  ['operations.config.cancelWindowTitle', 'Cancelar janela'],
  ['operations.config.cancelWindowMessage', 'Cancelar a janela de manutenção "Upgrade"?', { name: 'Upgrade' }],
  ['operations.config.section', 'Alertas'],
  ['operations.config.searchPlaceholder', 'Pesquisar alertas…'],
  ['operations.config.searchAria', 'Pesquisar alertas'],
  ['operations.config.refresh', 'Atualizar'],
  ['operations.config.auditHistory', 'Histórico de auditoria'],
  ['operations.config.intro', 'Alertas por resolver, janelas de manutenção e regras de alerta. Alertas críticos permanecem ativos durante qualquer janela.'],
  ['operations.config.rulesTitle', 'Regras de alerta'],
  ['operations.config.name', 'Nome'],
  ['operations.config.addRule', 'Adicionar regra'],
  ['operations.config.minimumSeverityOf', 'mínimo Aviso', { severity: 'Aviso' }],
  ['operations.config.ruleActive', 'Ativa'],
  ['operations.config.ruleInactive', 'Inativa'],
  ['operations.config.edit', 'Editar'],
  ['operations.config.noRules', 'Ainda não existem regras configuradas.'],
  ['operations.config.windowsTitle', 'Períodos agendados'],
  ['operations.config.start', 'Início'],
  ['operations.config.end', 'Fim'],
  ['operations.config.reason', 'Motivo'],
  ['operations.config.scheduleWindow', 'Agendar janela'],
  ['operations.config.editWindowNamed', 'Editar janela Upgrade', { name: 'Upgrade' }],
  ['operations.config.cancel', 'Cancelar'],
  ['operations.config.noWindows', 'Sem janelas agendadas.'],
  ['operations.config.activeAlertsLabel', 'Alertas ativos:'],
  ['operations.config.governed', '4 visíveis · 2 abaixo do mínimo · 1 em manutenção', { shown: 4, belowThreshold: 2, inMaintenance: 1 }],
  ['operations.config.eventType', 'Tipo de evento'],
  ['operations.config.chooseEventType', 'Escolher tipo de evento…'],
  ['operations.config.minimumSeverity', 'Severidade mínima'],
  ['operations.config.ruleEnabled', 'Regra ativa'],
  ['operations.config.saving', 'A guardar…'],
  ['operations.config.saveRule', 'Guardar regra'],
  ['operations.config.saveWindow', 'Guardar janela'],
  ['operations.panel.refreshError', 'Não foi possível atualizar os alertas. A lista pode estar desatualizada.'],
  ['operations.panel.loadError', 'Não foi possível carregar os alertas. Tenta atualizar.'],
  ['operations.panel.loading', 'A carregar alertas…'],
  ['operations.panel.label', 'Operações'],
  ['operations.panel.viewAll', 'Ver tudo'],
  ['operations.panel.alertList', 'Lista de alertas'],
  ['operations.panel.rules', 'Regras'],
  ['operations.panel.refreshAlerts', 'Atualizar alertas'],
  ['operations.panel.snoozedHidden', 'Adiados não aparecem aqui.'],
  ['operations.panel.viewSnoozed', 'Ver adiados'],
  ['operations.panel.activeList', 'Lista de alertas ativos'],
  ['operations.panel.markAllRead', 'Marcar tudo como lido'],
  ['operations.panel.quality.title', 'Qualidade dos dados'],
  ['operations.panel.quality.openQueue', 'Abrir fila'],
  ['operations.panel.quality.loadError', 'Não foi possível carregar a qualidade dos dados. Tenta atualizar.'],
  ['operations.panel.quality.valid.one', '1 dispositivo sem problemas', { count: 1 }],
  ['operations.panel.quality.valid.other', '37 dispositivos sem problemas', { count: 37 }],
  ['operations.panel.quality.affected.one', '1 dispositivo afetado', { count: 1 }],
  ['operations.panel.quality.affected.other', '37 dispositivos afetados', { count: 37 }],
  ['operations.panel.quality.stale.one', '1 finding desatualizado', { count: 1 }],
  ['operations.panel.quality.stale.other', '37 findings desatualizados', { count: 37 }],
  ['operations.panel.quality.queue', 'Fila de qualidade dos dados'],
  ['operations.panel.quality.noOpen', 'Sem findings em aberto.'],
  ['operations.quality.statusTab.OPEN', 'Abertos'],
  ['operations.quality.statusTab.ACKNOWLEDGED', 'Reconhecidos'],
  ['operations.quality.statusTab.SNOOZED', 'Adiados'],
  ['operations.quality.statusTab.RESOLVED', 'Resolvidos'],
  ['operations.quality.status.OPEN', 'Aberto'],
  ['operations.quality.status.ACKNOWLEDGED', 'Reconhecido'],
  ['operations.quality.status.SNOOZED', 'Adiado'],
  ['operations.quality.status.RESOLVED', 'Resolvido'],
  ['operations.quality.severity.CRITICAL', 'Crítico'],
  ['operations.quality.severity.HIGH', 'Alto'],
  ['operations.quality.severity.WARNING', 'Aviso'],
  ['operations.quality.severity.INFO', 'Info'],
  ['operations.quality.rule.DEVICE_MISSING_SITE', 'Equipamento sem Site'],
  ['operations.quality.rule.DEVICE_MISSING_LOCATION', 'Equipamento sem localização'],
  ['operations.quality.rule.DEVICE_MISSING_MODEL', 'Equipamento sem modelo'],
  ['operations.quality.rule.NETWORK_DEVICE_MISSING_MANAGEMENT_IP', 'Equipamento de rede sem IP de gestão'],
  ['operations.quality.rule.INTERFACE_MISSING_MODE', 'Interface sem modo'],
  ['operations.quality.rule.ACCESS_INTERFACE_MISSING_VLAN', 'Interface access sem VLAN'],
  ['operations.quality.rule.TRUNK_INTERFACE_MISSING_VLANS', 'Interface trunk sem VLANs permitidas'],
  ['operations.quality.rule.NETWORK_MODEL_MISSING_PORT_MAP', 'Mapeamento de portas em falta'],
  ['operations.quality.rule.DEVICE_MODEL_MISSING_FRONT_IMAGE', 'Modelo sem vista frontal'],
  ['operations.quality.rule.STALE_SNMP_OBSERVATION', 'Observação SNMP desatualizada'],
  ['operations.quality.rule.STALE_SNMP_DRIFT', 'Divergência SNMP por resolver'],
  ['operations.quality.rule.DUPLICATE_IP_ROUTING_DOMAIN', 'IP duplicado no domínio de routing'],
  ['operations.quality.failure.NOT_FOUND', 'Não encontrado ou sem acesso'],
  ['operations.quality.failure.FORBIDDEN', 'Sem permissão neste Site'],
  ['operations.quality.failure.INVALID', 'Pedido inválido'],
  ['operations.quality.failure.ERROR', 'Erro inesperado'],
  ['operations.quality.applied', 'Aplicado'],
  ['operations.quality.bulk.title.ACKNOWLEDGE', 'Reconhecer selecionados'],
  ['operations.quality.bulk.title.ASSIGN', 'Atribuir selecionados'],
  ['operations.quality.bulk.title.SNOOZE', 'Adiar selecionados'],
  ['operations.quality.bulk.singleTitle.ACKNOWLEDGE', 'Reconhecer finding'],
  ['operations.quality.bulk.singleTitle.ASSIGN', 'Atribuir finding'],
  ['operations.quality.bulk.singleTitle.SNOOZE', 'Adiar finding'],
  ['operations.quality.bulk.selection.one', '1 finding selecionado.', { count: 1 }],
  ['operations.quality.bulk.selection.other', '37 findings selecionados. Cada finding é verificado à parte; uma falha não impede os restantes.', { count: 37 }],
  ['operations.quality.bulk.findingNamed', 'Finding: core-sw-01', { title: 'core-sw-01' }],
  ['operations.quality.bulk.snoozeFor', 'Adiar durante'],
  ['operations.quality.bulk.results', 'Resultado por finding'],
  ['operations.quality.bulk.result', 'Resultado'],
  ['operations.quality.bulk.close', 'Fechar'],
  ['operations.quality.bulk.applying', 'A aplicar…'],
  ['operations.quality.bulk.run.ACKNOWLEDGE', 'Reconhecer'],
  ['operations.quality.bulk.run.ASSIGN', 'Atribuir'],
  ['operations.quality.bulk.run.SNOOZE', 'Adiar'],
  ['operations.quality.bulk.runCount.ACKNOWLEDGE', 'Reconhecer 37', { count: 37 }],
  ['operations.quality.bulk.runCount.ASSIGN', 'Atribuir 37', { count: 37 }],
  ['operations.quality.bulk.runCount.SNOOZE', 'Adiar 37', { count: 37 }],
  ['operations.quality.finding', 'Finding'],
  ['operations.quality.rule', 'Regra'],
  ['operations.quality.assignee', 'Responsável'],
  ['operations.quality.unassigned', 'Sem responsável'],
  ['operations.quality.lastDetected', 'Última deteção'],
  ['operations.quality.suggestedCorrection', 'Correção sugerida: Definir o Site', { correction: 'Definir o Site' }],
  ['operations.quality.assignNamed', 'Atribuir core-sw-01', { title: 'core-sw-01' }],
  ['operations.quality.assignEllipsis', 'Atribuir…'],
  ['operations.quality.snoozeEllipsis', 'Adiar…'],
  ['operations.quality.openDeviceNamed', 'Abrir equipamento de core-sw-01', { title: 'core-sw-01' }],
  ['operations.quality.openDevice', 'Abrir equipamento'],
  ['operations.quality.openRecordNamed', 'Abrir registo de core-sw-01', { title: 'core-sw-01' }],
  ['operations.quality.openRecord', 'Abrir registo'],
  ['operations.quality.bulkFailed', 'A operação em massa falhou.'],
  ['operations.quality.acknowledgeConfirm.one', 'Reconhecer 1 finding selecionado? Continua na fila até deixar de ser detetado.', { count: 1 }],
  ['operations.quality.acknowledgeConfirm.other', 'Reconhecer 37 findings selecionados? Continuam na fila até deixarem de ser detetados.', { count: 37 }],
  ['operations.quality.acknowledgeTitle.one', 'Reconhecer finding'],
  ['operations.quality.acknowledgeTitle.other', 'Reconhecer findings'],
  ['operations.quality.acknowledgeError', 'Não foi possível reconhecer o finding.'],
  ['operations.quality.all', 'Todos'],
  ['operations.quality.acknowledgeCount', 'Reconhecer (37)', { count: 37 }],
  ['operations.quality.assignCount', 'Atribuir… (37)', { count: 37 }],
  ['operations.quality.snoozeCount', 'Adiar… (37)', { count: 37 }],
  ['operations.quality.resolvedNamed', 'core-sw-01 resolvido', { title: 'core-sw-01' }],
  ['operations.quality.selectAll', 'Selecionar todos os findings visíveis'],
  ['operations.quality.noMatch', 'Sem findings correspondentes.'],
  ['operations.quality.noOpen', 'Sem findings abertos neste Site.'],
  ['operations.quality.noneInStatus', 'Sem findings neste estado.'],
  ['operations.quality.section', 'Qualidade do inventário'],
  ['operations.quality.searchPlaceholder', 'Pesquisar título, detalhe ou correção…'],
  ['operations.quality.searchAria', 'Pesquisar findings'],
  ['operations.quality.filterSeverity', 'Filtrar por severidade'],
  ['operations.quality.filterRule', 'Filtrar por regra'],
  ['operations.quality.filterAssignee', 'Filtrar por responsável'],
  ['operations.quality.group', 'Agrupar'],
  ['operations.quality.groupAria', 'Agrupar findings'],
  ['operations.quality.noGrouping', 'Sem agrupamento'],
  ['operations.quality.byRule', 'Por regra'],
  ['operations.quality.title', 'Fila do inventário'],
  ['operations.quality.description', 'Problemas detetados automaticamente. Age em cada finding na sua linha, ou seleciona findings visíveis para os reconhecer, atribuir ou adiar em conjunto.'],
  ['operations.quality.chooseSite', 'Escolhe um Site para ver a fila.'],
  ['operations.quality.overLimit', 'Seleciona no máximo 200 findings de cada vez.', { count: 200 }],
  ['operations.quality.byStatus', 'Findings por estado'],
  ['operations.quality.loadedOf', '50 de 237 findings carregados', { loaded: 50, total: 237 }],
  ['operations.quality.count.one', '1 finding', { count: 1 }],
  ['operations.quality.count.other', '37 findings', { count: 37 }],
  ['operations.quality.selectedCount', '37 selecionados', { count: 37 }],
  ['operations.quality.tableLabel', 'Findings de qualidade do inventário'],
  ['operations.quality.loading', 'A carregar…'],
  ['operations.quality.loadMore', 'Carregar mais findings'],
];

// These showed Portuguese in English before (the source-text table had no entry for the built text): they now have a real translation.
const untranslatedBefore = new Set([
  'operations.alerts.bulk.selected.other',
  'operations.alerts.done.ACKNOWLEDGE.one',
  'operations.alerts.done.ACKNOWLEDGE.other',
  'operations.alerts.done.RESOLVE.one',
  'operations.alerts.done.RESOLVE.other',
  'operations.alerts.done.SNOOZE.one',
  'operations.alerts.done.SNOOZE.other',
  'operations.alerts.failed.one',
  'operations.alerts.failed.other',
  'operations.alerts.resolveNamed',
  'operations.alerts.selectNamed',
  'operations.config.governed',
  'operations.config.minimumSeverityOf',
  'operations.panel.quality.affected.one',
  'operations.panel.quality.affected.other',
  'operations.panel.quality.stale.one',
  'operations.panel.quality.stale.other',
  'operations.panel.quality.valid.one',
  'operations.panel.quality.valid.other',
  'operations.quality.acknowledgeTitle.other',
  'operations.quality.resolvedNamed',
]);
const sourceFiles = [
  'alert-actions.tsx', 'alert-configuration-page.tsx', 'alert-detail.tsx', 'alert-meta.ts', 'alert-severity.tsx', 'alerts-overview.tsx',
  'inventory-quality-page.tsx', 'operations-panel.tsx', 'quality-bulk-dialog.tsx', 'quality-workspace.ts',
];
const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

describe('operations keyed messages', () => {
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

  it('covers every key the operations screens use, in both locales and the added languages', () => {
    const source = sourceFiles.map(read).join('\n');
    const all = new Set(keyed.map(([key]) => key));
    const used = new Set<string>();
    for (const [, key] of source.matchAll(/'(operations\.[\w.]+)'/g)) {
      // A key called with { count } resolves to its .one / .other forms.
      if (!all.has(key) && all.has(`${key}.one`)) { used.add(`${key}.one`); used.add(`${key}.other`); } else used.add(key);
    }
    // Keys built from a value: statuses, severities, sources, rules, actions and snooze units.
    const prefixes = [...new Set([...source.matchAll(/`(operations\.[\w.]+\.)\$\{/g)].map((match) => match[1]))].sort();
    expect(prefixes).toEqual([
      'operations.alerts.done.', 'operations.alerts.failure.', 'operations.alerts.history.', 'operations.alerts.nextStep.', 'operations.alerts.source.', 'operations.alerts.status.',
      'operations.quality.bulk.run.', 'operations.quality.bulk.runCount.', 'operations.quality.bulk.singleTitle.', 'operations.quality.bulk.title.',
      'operations.quality.failure.', 'operations.quality.rule.', 'operations.quality.severity.', 'operations.quality.status.', 'operations.quality.statusTab.',
      'operations.severity.', 'operations.severityMeaning.', 'operations.snooze.',
    ]);
    for (const key of all) if (prefixes.some((prefix) => key.startsWith(prefix))) used.add(key);
    expect([...used].sort()).toEqual([...all].sort());
    for (const [key] of keyed) {
      for (const locale of ['pt-PT', 'en-US'] as AppLocale[]) expect(translateMessage(locale, key, '∅')).not.toBe('∅');
      for (const bundle of [esES, frFR, deDE, itIT]) expect(bundle[key as keyof typeof bundle], key).toBeTruthy();
    }
  });

  it.each(sourceFiles)('leaves no Portuguese literal in %s', (file) => {
    const source = read(file).replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).not.toMatch(/[áàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]/);
    expect(source).not.toMatch(/['"`>]\s*(Reconhecer|Adiar|Resolver|Atualizar|Cancelar|Fechar|Guardar|Eliminar|Editar|Detalhe|Regras|Todos|Todas|Abrir|Atribuir|Agendada|Remover|Voltar|Nome|Motivo|Fim)\b/);
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

const { InventoryQualityCard } = await import('./operations-panel');
const { SeverityLegend } = await import('./alert-severity');
const { ReadOnlyAlertNote } = await import('./alert-actions');
const quality = { score: 90, validDeviceCount: 1, affectedDeviceCount: 2, staleFindingCount: 1 } as never;

afterEach(() => { cleanup(); locale.current = 'en-US'; });

describe('operations screens follow the active language', () => {
  it('renders the quality card, severity legend and read-only note in English', () => {
    render(<><InventoryQualityCard quality={quality} findings={[]} compact /><SeverityLegend /><ReadOnlyAlertNote /></>);
    expect(screen.getByRole('heading', { name: translateSourceText('en-US', 'Qualidade dos dados') })).toBeTruthy();
    expect(screen.getByText(translateMessage('en-US', 'operations.panel.quality.valid.one', undefined, { count: 1 }))).toBeTruthy();
    expect(screen.getByText(translateSourceText('en-US', 'O que significa cada severidade?'))).toBeTruthy();
    expect(screen.getAllByText(translateSourceText('en-US', 'Crítico')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Qualidade dos dados')).toBeNull();
    expect(screen.queryByText(/Tens acesso só de leitura/)).toBeNull();
  });

  it('renders the same screens in Portuguese', () => {
    locale.current = 'pt-PT';
    render(<><InventoryQualityCard quality={quality} findings={[]} compact /><SeverityLegend /><ReadOnlyAlertNote /></>);
    expect(screen.getByRole('heading', { name: 'Qualidade dos dados' })).toBeTruthy();
    expect(screen.getByText('1 dispositivo sem problemas')).toBeTruthy();
    expect(screen.getByText(/2 dispositivos afetados · 1 finding desatualizado/)).toBeTruthy();
    expect(screen.getByText('O que significa cada severidade?')).toBeTruthy();
    expect(screen.getByText(/Tens acesso só de leitura/)).toBeTruthy();
    expect(screen.getByText('Sem findings em aberto.')).toBeTruthy();
  });
});
