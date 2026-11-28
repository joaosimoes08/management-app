import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateMessage, type AppLocale } from '@/lib/i18n/i18n';
import { messages as deDE } from '@/lib/i18n/messages/topology/de-DE';
import { messages as esES } from '@/lib/i18n/messages/topology/es-ES';
import { messages as frFR } from '@/lib/i18n/messages/topology/fr-FR';
import { messages as itIT } from '@/lib/i18n/messages/topology/it-IT';

// Topology moved from hard-coded Portuguese (translated on the page from source-text-messages.ts)
// to keyed messages. Each key must render exactly what the old Portuguese source showed, and en-US
// exactly what the source-text table made of it. Plural keys are listed once per form (count 1 and 97).
const keyed: Array<[key: string, portuguese: string, params?: Record<string, string | number>]> = [
  ['topology.impactPanel.couldNotCalculateTheImpact', 'Não foi possível calcular o impacto.'],
  ['topology.impactPanel.critical', 'Crítico'],
  ['topology.impactPanel.includeLogicalConnections', 'Incluir ligações lógicas'],
  ['topology.impactPanel.viewInTopology', 'Ver na Topologia'],
  ['topology.impactPanel.calculatingImpact', 'A calcular impacto…'],
  ['topology.impactPanel.goDown', 'Vão abaixo'],
  ['topology.impactPanel.loseEveryPath', 'Ficam sem caminho'],
  ['topology.impactPanel.loseOnePowerFeed', 'Perdem uma alimentação'],
  ['topology.impactPanel.hostsServices', 'Hosts / serviços'],
  ['topology.impactPanel.portalApplications', 'Aplicações do Portal'],
  ['topology.impactPanel.tier1Assets', 'Ativos Tier 1'],
  ['topology.impactPanel.theSearchStoppedAtThe', 'Pesquisa interrompida no limite de profundidade.'],
  ['topology.impactPanel.moreDevicesMayBeAffected', 'Podem existir mais equipamentos afetados para além do que é mostrado.'],
  ['topology.impactPanel.limit', 'Limite:'],
  ['topology.impactPanel.noVisibleRouterOrFirewall', 'Não há router nem firewall visível neste Site: os equipamentos sem caminho foram estimados em relação ao maior segmento de rede que resta.'],
  ['topology.impactPanel.devicesOutsideYourScopeNot', 'Equipamentos fora do teu âmbito (não mostrados):'],
  ['topology.impactPanel.noAffectedDevicesWereFound', 'Não foram encontrados equipamentos afetados nas ligações documentadas.'],
  ['topology.impactPanel.thisResultDoesNotConfirm', 'Este resultado não confirma impacto zero.'],
  ['topology.impactPanel.hops', 'saltos:'],
  ['topology.impactPanel.loseOnePowerFeedStill', 'Perdem uma alimentação (continuam ligados)'],
  ['topology.impactPanel.hostsAndServices', 'Hosts e serviços'],
  ['topology.impactPanel.noServices', 'Sem serviços'],
  ['topology.impactPanel.criticalAssetsByTier', 'Ativos críticos por tier'],
  ['topology.impactPanel.criticalNoTier', 'Crítico sem tier'],
  ['topology.impactPanel.calculatedFromTheConnectionsAnd', 'Calculado a partir das ligações e tomadas de PDU documentadas no inventário.'],
  ['topology.impactPanel.whatGoesDown', 'O que vai abaixo'],
  ['topology.impactPanel.couldNotCalculateThePath', 'Não foi possível calcular o caminho.'],
  ['topology.impactPanel.source', 'Origem'],
  ['topology.impactPanel.pathStartDevice', 'Equipamento de origem do caminho'],
  ['topology.impactPanel.select', 'Seleciona…'],
  ['topology.impactPanel.destination', 'Destino'],
  ['topology.impactPanel.pathEndDevice', 'Equipamento de destino do caminho'],
  ['topology.impactPanel.calculating', 'A calcular…'],
  ['topology.impactPanel.showPath', 'Mostrar caminho'],
  ['topology.impactPanel.clearPath', 'Limpar caminho'],
  ['topology.impactPanel.theTwoDevicesAreIn', 'Os dois equipamentos estão em Sites diferentes.'],
  ['topology.impactPanel.thereIsNoDocumentedPath', 'Não há caminho documentado entre estes equipamentos dentro do limite de profundidade.'],
  ['topology.impactPanel.documentedPath', 'Caminho documentado'],
  ['topology.impactPanel.deviceOutsideYourScope', 'Equipamento fora do teu âmbito'],
  ['topology.impactPanel.hops2', 'Saltos:'],
  ['topology.observedTopology.couldNotApplyThisProposal', 'Não foi possível aplicar esta proposta.'],
  ['topology.observedTopology.couldNotRejectThisProposal', 'Não foi possível rejeitar esta proposta.'],
  ['topology.observedTopology.couldNotRevertThisChange', 'Não foi possível reverter esta alteração.'],
  ['topology.observedTopology.equipment', 'Equipamento'],
  ['topology.observedTopology.deviceForSnmpObservation', 'Equipamento para observação SNMP'],
  ['topology.observedTopology.selectADevice', 'Seleciona um equipamento'],
  ['topology.observedTopology.refresh', 'Atualizar'],
  ['topology.observedTopology.interfacesAndLinksCollectedOver', 'Interfaces e ligações recolhidas por SNMP'],
  ['topology.observedTopology.observationsStaySeparateFromThe', 'As observações permanecem separadas do inventário. Só propostas revistas alteram dados mantidos.'],
  ['topology.observedTopology.selectASiteToView', 'Seleciona um site para consultar a topologia observada.'],
  ['topology.observedTopology.couldNotLoadSnmpObservations', 'Não foi possível carregar observações SNMP.'],
  ['topology.observedTopology.loadingDevices', 'A carregar equipamentos…'],
  ['topology.observedTopology.noManagementIp', 'Sem IP de gestão'],
  ['topology.observedTopology.loadingTheLatestSnmpCollection', 'A carregar última recolha SNMP…'],
  ['topology.observedTopology.lastCollectionCompleted', 'Última recolha concluída'],
  ['topology.observedTopology.observedInterfaces', 'Interfaces observadas'],
  ['topology.observedTopology.theLatestCollectionHasNo', 'A última recolha não contém interfaces observadas.'],
  ['topology.observedTopology.thereIsNoSnmpCollection', 'Ainda não existe uma recolha SNMP para este equipamento.'],
  ['topology.observedTopology.linksBetweenDevices', 'Ligações entre equipamentos'],
  ['topology.observedTopology.loadingObservedLinks', 'A carregar ligações observadas…'],
  ['topology.observedTopology.noObservedLinksInThis', 'Sem ligações observadas nesta recolha'],
  ['topology.observedTopology.thereAreNoLldpOr', 'Não há vizinhanças LLDP ou CDP registadas para este equipamento.'],
  ['topology.observedTopology.unidentifiedNeighbor', 'Vizinho por identificar'],
  ['topology.observedTopology.unknownLocalPort', 'Porta local desconhecida'],
  ['topology.observedTopology.unknownRemotePort', 'Porta remota desconhecida'],
  ['topology.observedTopology.source', 'Origem:'],
  ['topology.observedTopology.confidence', 'Confiança:'],
  ['topology.observedTopology.observed', 'Observado:'],
  ['topology.observedTopology.freshness', 'Frescura:'],
  ['topology.observedTopology.ambiguous', 'Ambíguo'],
  ['topology.observedTopology.resolved', 'Resolvido'],
  ['topology.observedTopology.unresolved', 'Por resolver'],
  ['topology.observedTopology.evidenceAndIdentifiers', 'Evidência e identificadores'],
  ['topology.observedTopology.remoteSystem', 'Sistema remoto:'],
  ['topology.observedTopology.managementAddress', 'Endereço de gestão:'],
  ['topology.observedTopology.linkProposedForReview', 'Ligação proposta para revisão'],
  ['topology.observedTopology.linkAppliedToTheInventory', 'Ligação aplicada ao inventário'],
  ['topology.observedTopology.proposalRejected', 'Proposta rejeitada'],
  ['topology.observedTopology.applicationReverted', 'Aplicação revertida'],
  ['topology.observedTopology.theCollectionDetectedChangesOn', 'A recolha detetou alterações numa ligação já registada; só a revisão controlada altera o inventário.'],
  ['topology.observedTopology.theNeighbourWasObservedBut', 'A vizinhança foi observada, mas ainda não consta como ligação manual.'],
  ['topology.observedTopology.before', 'Antes'],
  ['topology.observedTopology.proposedLink', 'Ligação proposta'],
  ['topology.observedTopology.noPermissionToReviewProposals', 'Sem permissões para rever propostas'],
  ['topology.observedTopology.theRemoteDeviceMustBe', 'O equipamento remoto tem de estar resolvido para aplicar a ligação'],
  ['topology.observedTopology.applyLink', 'Aplicar ligação'],
  ['topology.observedTopology.reject', 'Rejeitar'],
  ['topology.observedTopology.revert', 'Reverter'],
  ['topology.observedTopology.inventoryProposals', 'Propostas para o inventário'],
  ['topology.observedTopology.additionsAndUpdatesNeedApproval', 'Adicionar e atualizar exigem aprovação. Candidatos a remoção ficam bloqueados.'],
  ['topology.observedTopology.loadingProposals', 'A carregar propostas…'],
  ['topology.observedTopology.observedInterfaceThatIsNot', 'Interface observada que ainda não existe no inventário.'],
  ['topology.observedTopology.observedValuesDifferFromThe', 'Valores observados diferem dos valores atualmente mantidos.'],
  ['topology.observedTopology.theInterfaceDidNotAppear', 'A interface não apareceu nesta recolha; remoção não pode ser inferida com segurança.'],
  ['topology.observedTopology.observationContext', 'Contexto da observação'],
  ['topology.observedTopology.currentInventoryValue', 'Valor atual no inventário'],
  ['topology.observedTopology.observedValue', 'Valor observado'],
  ['topology.observedTopology.proposedDifferences', 'Diferenças propostas'],
  ['topology.observedTopology.noPreviousValuesRecorded', 'Sem valores anteriores registados.'],
  ['topology.observedTopology.blockedRemovalCandidatesCannotBe', 'Bloqueada: candidatos a remoção não podem ser aplicados.'],
  ['topology.observedTopology.apply', 'Aplicar'],
  ['topology.observedTopology.applied', 'Aplicada'],
  ['topology.observedTopology.audit', 'auditoria'],
  ['topology.observedTopology.rolledBack', 'Revertida'],
  ['topology.observedTopology.rejected', 'Rejeitada'],
  ['topology.observedTopology.noPermissionToRevertProposals', 'Sem permissões para reverter propostas'],
  ['topology.observedTopology.thereAreNoInterfaceProposals', 'Ainda não existem propostas de interface para este equipamento.'],
  ['topology.filtersMenu.filters', 'Filtros'],
  ['topology.filtersMenu.filterMap', 'Filtrar mapa'],
  ['topology.filtersMenu.deviceType', 'Tipo de equipamento'],
  ['topology.filtersMenu.filterByDeviceType', 'Filtrar por tipo de equipamento'],
  ['topology.filtersMenu.allTypes', 'Todos os tipos'],
  ['topology.filtersMenu.location', 'Localização'],
  ['topology.filtersMenu.filterByLocation', 'Filtrar por localização'],
  ['topology.filtersMenu.allLocations', 'Todas as localizações'],
  ['topology.filtersMenu.problemState', 'Estado de problemas'],
  ['topology.filtersMenu.filterByProblemState', 'Filtrar por estado de problemas'],
  ['topology.filtersMenu.alertsUnavailableTheProblemFilter', 'Alertas indisponíveis: o filtro de problemas está desativado.'],
  ['topology.filtersMenu.clearFilters', 'Limpar filtros'],
  ['topology.filtersMenu.legend', 'Legenda'],
  ['topology.filtersMenu.mapLegend', 'Legenda do mapa'],
  ['topology.filtersMenu.deviceTypes', 'Tipos de equipamento'],
  ['topology.filtersMenu.noDevicesOnTheMap', 'Sem equipamentos no mapa.'],
  ['topology.filtersMenu.activeAlerts', 'Alertas ativos'],
  ['topology.filtersMenu.devicesWithActiveAlertsShow', 'Os equipamentos com alertas ativos mostram um selo com o número de alertas, na cor da severidade mais alta.'],
  ['topology.page.notSet', 'Não definido'],
  ['topology.page.model', 'Modelo:'],
  ['topology.page.location', 'Localização:'],
  ['topology.page.notSet2', 'Não definida'],
  ['topology.page.notSet3', 'não definido'],
  ['topology.page.activeAlerts', 'Alertas ativos:'],
  ['topology.page.fullScreenModeOff', 'Modo de ecrã inteiro desativado.'],
  ['topology.page.fullScreenModeOnPress', 'Modo de ecrã inteiro ativado. Prima Escape para sair.'],
  ['topology.page.couldNotCreateTheMap', 'Não foi possível criar o mapa. Confirma as permissões do Site e tenta novamente.'],
  ['topology.page.couldNotDeleteTheMap', 'Não foi possível eliminar o mapa. Confirma as permissões do Site e tenta novamente.'],
  ['topology.page.thisMapWasChangedIn', 'Este mapa foi alterado noutro separador. As posições locais foram mantidas; recarrega ou tenta guardar novamente.'],
  ['topology.page.couldNotSaveThePositions', 'Não foi possível guardar as posições. As posições locais foram mantidas; tenta novamente.'],
  ['topology.page.selectAFreePortOn', 'Seleciona uma porta livre em cada equipamento para criar a ligação.'],
  ['topology.page.oneOfThePortsIs', 'Uma das portas já está ligada. Escolhe novamente entre as portas livres.'],
  ['topology.page.theMapHasChangedMeanwhile', 'O mapa mudou entretanto. Recarrega antes de criar a ligação.'],
  ['topology.page.couldNotCreateTheLink', 'Não foi possível criar a ligação.'],
  ['topology.page.theMapHasChangedMeanwhile2', 'O mapa mudou entretanto. Recarrega antes de adicionar o equipamento.'],
  ['topology.page.couldNotAddTheDevice', 'Não foi possível adicionar o equipamento ao mapa.'],
  ['topology.page.oneOfThePortsIs2', 'Uma das portas já foi atribuída a outra ligação. Escolhe novamente entre as portas livres.'],
  ['topology.page.theMapHasChangedMeanwhile3', 'O mapa mudou entretanto. Recarrega antes de atualizar a ligação.'],
  ['topology.page.couldNotUpdateTheLink', 'Não foi possível atualizar a ligação.'],
  ['topology.page.theMapHasChangedMeanwhile4', 'O mapa mudou entretanto. Recarrega antes de remover a ligação.'],
  ['topology.page.couldNotRemoveTheLink', 'Não foi possível remover a ligação.'],
  ['topology.page.siteMap', 'Mapa do site'],
  ['topology.page.selectAMap', 'Seleciona mapa…'],
  ['topology.page.finishLink', 'Concluir ligação'],
  ['topology.page.selectTheLinkPorts', 'Seleciona as portas da ligação'],
  ['topology.page.sourcePort', 'Porta de origem'],
  ['topology.page.sourcePortOfTheNew', 'Porta de origem da nova ligação'],
  ['topology.page.checkingAvailability', 'A verificar disponibilidade…'],
  ['topology.page.selectAFreePort', 'Seleciona uma porta livre'],
  ['topology.page.noFreePorts', 'Sem portas livres'],
  ['topology.page.destinationPort', 'Porta de destino'],
  ['topology.page.destinationPortOfTheNew', 'Porta de destino da nova ligação'],
  ['topology.page.couldNotCheckTheFree', 'Não foi possível verificar as portas livres. Atualiza o mapa e tenta novamente.'],
  ['topology.page.createLink', 'Criar ligação'],
  ['topology.page.cancel', 'Cancelar'],
  ['topology.page.impactAndPath', 'Impacto e caminho'],
  ['topology.page.impact', 'Impacto'],
  ['topology.page.deviceThatGoesDown', 'Equipamento que vai abaixo'],
  ['topology.page.deviceToAnalyseImpactFor', 'Equipamento para analisar impacto'],
  ['topology.page.select', 'Seleciona…'],
  ['topology.page.analyseImpact', 'Analisar impacto'],
  ['topology.page.pathBetweenTwoDevices', 'Caminho entre dois equipamentos'],
  ['topology.page.editMap', 'Editar mapa'],
  ['topology.page.createMap', 'Criar mapa'],
  ['topology.page.name', 'Nome'],
  ['topology.page.newMapName', 'Nome do novo mapa'],
  ['topology.page.eGMainNetwork', 'Ex.: Rede principal'],
  ['topology.page.type', 'Tipo'],
  ['topology.page.newMapType', 'Tipo do novo mapa'],
  ['topology.page.linkedVlans', 'VLANs associadas'],
  ['topology.page.mapVlans', 'VLANs do mapa'],
  ['topology.page.creating', 'A criar…'],
  ['topology.page.addEquipment', 'Adicionar equipamento'],
  ['topology.page.equipment', 'Equipamento'],
  ['topology.page.deviceToAdd', 'Equipamento para adicionar'],
  ['topology.page.addToMap', 'Adicionar ao mapa'],
  ['topology.page.selectedLink', 'Ligação selecionada'],
  ['topology.page.documented', 'Documentada'],
  ['topology.page.tag', 'Etiqueta'],
  ['topology.page.linkLabel', 'Etiqueta da ligação'],
  ['topology.page.portNotGiven', 'Porta não indicada'],
  ['topology.page.couldNotCheckPortAvailability', 'Não foi possível verificar a disponibilidade das portas.'],
  ['topology.page.physicalPathPatchPanel', 'Percurso físico / patch panel'],
  ['topology.page.patchPanelPortRackCable', 'Patch panel, porta, bastidor, etiqueta do cabo…'],
  ['topology.page.linkType', 'Tipo da ligação'],
  ['topology.page.physical', 'Física'],
  ['topology.page.logical', 'Lógica'],
  ['topology.page.saveLink', 'Guardar ligação'],
  ['topology.page.removeLink', 'Remover ligação'],
  ['topology.page.deleting', 'A eliminar…'],
  ['topology.page.deleteMap', 'Eliminar mapa'],
  ['topology.page.tryCreatingAgain', 'Tentar criar novamente'],
  ['topology.page.tryDeletingAgain', 'Tentar eliminar novamente'],
  ['topology.page.mapControls', 'Controlos do mapa'],
  ['topology.page.findDevice', 'Encontrar equipamento'],
  ['topology.page.hideLabels', 'Ocultar etiquetas'],
  ['topology.page.showLabels', 'Mostrar etiquetas'],
  ['topology.page.hideGrid', 'Ocultar grelha'],
  ['topology.page.showGrid', 'Mostrar grelha'],
  ['topology.page.zoomIn', 'Ampliar'],
  ['topology.page.zoomOut', 'Reduzir'],
  ['topology.page.fitMap', 'Ajustar mapa'],
  ['topology.page.lockMap', 'Bloquear mapa'],
  ['topology.page.unlockMap', 'Desbloquear mapa'],
  ['topology.page.toggleFullScreen', 'Alternar ecrã inteiro'],
  ['topology.page.topology', 'Topologia'],
  ['topology.page.infrastructure', 'Infraestrutura'],
  ['topology.page.searchForADeviceOn', 'Procurar equipamento no mapa'],
  ['topology.page.manualMaps', 'Mapas manuais'],
  ['topology.page.topologyView', 'Visualização de topologia'],
  ['topology.page.observedAndReconciliation', 'Observada e reconciliação'],
  ['topology.page.topologyMapArea', 'Área do mapa de topologia'],
  ['topology.page.noDeviceFoundFor', 'Nenhum equipamento encontrado para “'],
  ['topology.page.noDeviceMatchesTheFilters', 'Nenhum equipamento corresponde aos filtros.'],
  ['topology.page.savingPositions', 'A guardar posições…'],
  ['topology.page.failedToSavePositions', 'Falha ao guardar posições.'],
  ['topology.page.tryAgain', 'Tentar novamente'],
  ['topology.page.reloadMap', 'Recarregar mapa'],
  ['topology.page.allPositionsAreSaved', 'Todas as posições estão guardadas.'],
  ['topology.page.linkConfiguration', 'Configuração da ligação'],
  ['topology.page.link', 'Ligação'],
  ['topology.page.closeConfiguration', 'Fechar configuração'],
  ['topology.page.linkEndpoints', 'Extremos da ligação'],
  ['topology.page.thereIsNoCliConfiguration', 'Não há configuração CLI disponível para esta ligação.'],
  ['topology.page.closeImpact', 'Fechar impacto'],
  ['topology.page.goesDown', 'Vai abaixo'],
  ['topology.page.noPath', 'Sem caminho'],
  ['topology.page.losesOnePowerFeed', 'Perde uma alimentação'],
  ['topology.page.notOnThisMap', 'Fora deste mapa:'],
  ['topology.page.selectAMapToHighlight', 'Seleciona um mapa para destacar os equipamentos afetados.'],
  ['topology.page.documentedPath', 'Caminho documentado'],
  ['topology.page.hops', 'Saltos:'],
  ['topology.page.selectOrCreateAMap', 'Seleciona ou cria um mapa'],
  ['topology.page.yourTopologyMapAppearsHere', 'O teu mapa de topologia aparece aqui.'],
  ['topology.filters.type.switch', 'Switch'],
  ['topology.filters.type.router', 'Router'],
  ['topology.filters.type.firewall', 'Firewall'],
  ['topology.filters.type.server', 'Servidor'],
  ['topology.filters.type.storage', 'Armazenamento'],
  ['topology.filters.type.otherType', 'Outro'],
  ['topology.filters.problem.all', 'Todos os estados'],
  ['topology.filters.problem.active', 'Com alertas ativos'],
  ['topology.filters.problem.critical', 'Com alertas críticos'],
  ['topology.filters.problem.healthy', 'Sem alertas ativos'],
  ['topology.filters.severity.critical', 'Crítico'],
  ['topology.filters.severity.high', 'Alto'],
  ['topology.filters.severity.warning', 'Aviso / médio'],
  ['topology.filters.severity.low', 'Baixo / informativo'],
  ['topology.filters.noLocation', 'Sem localização'],
  ['topology.impactPanel.reason.origin', 'Origem'],
  ['topology.impactPanel.reason.rack', 'No bastidor'],
  ['topology.impactPanel.reason.power', 'Sem energia'],
  ['topology.impactPanel.impact', 'Impacto'],
  ['topology.observedTopology.action.add', 'Adicionar interface'],
  ['topology.observedTopology.action.update', 'Atualizar interface'],
  ['topology.observedTopology.action.removalCandidate', 'Candidato a remoção · bloqueado'],
  ['topology.observedTopology.action.connectionAdd', 'Proposta de ligação'],
  ['topology.observedTopology.action.connectionUpdate', 'Proposta de atualização de ligação'],
  ['topology.page.portNotSet', 'Porta não definida'],
  ['topology.filtersMenu.filtersCount', 'Filtros (3)', { count: '3' }],
  ['topology.page.activeAlertsLabel', '3 alertas ativos · CRITICAL', { count: '3', severity: 'CRITICAL' }],
];

// Documented exceptions to en == translateSourceText: where today's English was still Portuguese, it now
// reads as proper English. Text that already was correct English is unchanged.
const englishFixes: Record<string, string> = {
  'topology.observedTopology.observedValue': 'Observed value', // was "Valor observed"
};

const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return name === '__fixtures__' ? [] : sourceFiles(path);
  return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
});
const files = sourceFiles(__dirname);

describe('topology keyed messages', () => {
  it.each(keyed)('%s renders the same Portuguese and English as before', (key, portuguese, params) => {
    expect(translateMessage('pt-PT', key, undefined, params)).toBe(portuguese);
    const english = translateMessage('en-US', key, undefined, params);
    expect(english).not.toBe(key);
    if (key in englishFixes) expect(english).toBe(englishFixes[key]);
  });

  it('writes proper English where the old translation was still Portuguese', () => {
    for (const [key, english] of Object.entries(englishFixes)) {
      const portuguese = translateMessage('pt-PT', key);
      expect(english).not.toBe(portuguese);
      expect(translateMessage('en-US', key)).toBe(english);
    }
  });

  it('covers every key the topology components use, in both locales and the added languages', () => {
    const used = new Set(files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/'(topology\.[\w.]+)'/g)].map((match) => match[1])).filter((key) => !key.startsWith('topology.observed.')));
    expect([...used].sort()).toEqual([...new Set(keyed.map(([key]) => key))].sort());
    for (const [key, , params] of keyed) {
      for (const locale of ['pt-PT', 'en-US'] as AppLocale[]) expect(translateMessage(locale, key, '∅', params)).not.toBe('∅');
      const forms = typeof params?.count === 'number' ? [`${key}.one`, `${key}.other`] : [key];
      for (const bundle of [esES, frFR, deDE, itIT]) for (const form of forms) expect(bundle[form], form).toBeTruthy();
    }
  });

  // Left on purpose: fallbacks of topology.observed.* keys that already exist in i18n.tsx (never shown, the key
  // wins), and the API's own Portuguese error text that the page matches to pick a message. The Portuguese
  // protocol phrases ('LLDP e CDP') are values matched against protocolKeys, not shown as such.
  const allowed: Record<string, string[]> = {
    'observed-topology.tsx': ["`${device.name} · ${device.managementIp || tx('topology.observed.noManagementIp', 'sem IP de gestão')}`", "'Evidência {protocols} da última recolha. As ligações observadas não alteram os mapas manuais.'", "'Evidência {protocol}'"],
    'topology-page.tsx': ["'já utilizadas'", "'já utilizadas'"],
  };

  it('leaves no Portuguese literal in the topology source files', () => {
    const found: Record<string, string[]> = {};
    for (const file of files) {
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`])\/\/.*$/gm, '$1');
      const literals = [...source.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|>([^<>{}]+)</g)]
        .map((match) => match[1] ?? match[0])
        .filter((text) => /[áàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]/.test(text));
      if (literals.length) found[relative(__dirname, file)] = literals;
    }
    expect(found).toEqual(allowed);
  });
});
