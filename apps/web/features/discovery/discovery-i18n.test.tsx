import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateMessage, type AppLocale } from '@/lib/i18n/i18n';
import { translateSourceText } from '@/lib/i18n/source-text-messages';
import { messages as deDE } from '@/lib/i18n/messages/discovery/de-DE';
import { messages as esES } from '@/lib/i18n/messages/discovery/es-ES';
import { messages as frFR } from '@/lib/i18n/messages/discovery/fr-FR';
import { messages as itIT } from '@/lib/i18n/messages/discovery/it-IT';
import { messages as ptPT } from '@/lib/i18n/messages/discovery/pt-PT';
import type { DiscoveryHostOutcome } from './api';
import { DiscoveryOutcomeCell } from './discovery-outcomes';

type Params = Record<string, string | number>;

// The Discovery screens moved from hard-coded Portuguese (translated on the page from source-text-messages.ts)
// to keyed messages. Each key must render exactly what the old Portuguese source showed, and en-US exactly
// what the source-text table made of it. Where that table returned Portuguese, the English is fixed and
// listed separately.
const keyed: Array<[key: string, portuguese: string, params?: Params]> = [
  ['discovery.missing.markFree', 'Marcar livre'],
  ['discovery.missing.back', 'Voltar'],
  ['discovery.missing.couldNotMarkTheAddress', 'Não foi possível marcar o endereço como livre.'],
  ['discovery.missing.occupiedIpsNotResponding', 'IPs ocupados sem resposta'],
  ['discovery.missing.addressesOccupiedInIpamThat', 'Endereços ocupados no IPAM que não responderam a nenhuma descoberta concluída da sua subnet nos últimos '],
  ['discovery.missing.daysNoAnswerDoesNot', ' dias. A falta de resposta não prova que o endereço está livre: confirma antes de o libertar.'],
  ['discovery.missing.couldNotLoadTheMissing', 'Não foi possível carregar os IPs desaparecidos.'],
  ['discovery.missing.openInIpam', 'Abrir no IPAM'],
  ['discovery.missing.markFree2', ' Marcar livre'],
  ['discovery.missing.noMatchingMissingIps', 'Sem IPs desaparecidos correspondentes'],
  ['discovery.missing.noOccupiedIpHasStopped', 'Nenhum IP ocupado deixou de responder'],
  ['discovery.schedulePanel.chooseAtLeastOneMethod', 'Escolhe pelo menos um método para a descoberta agendada.'],
  ['discovery.schedulePanel.setBetween1And64', 'Define entre 1 e 64 portas TCP válidas (1–65535).'],
  ['discovery.schedulePanel.couldNotSaveTheSchedule', 'Não foi possível guardar o schedule.'],
  ['discovery.schedulePanel.configureAtLeastOneMethod', 'Configura pelo menos um método e, para TCP, entre 1 e 64 portas válidas.'],
  ['discovery.schedulePanel.couldNotChangeTheSchedule', 'Não foi possível alterar o schedule.'],
  ['discovery.schedulePanel.discoverySchedules', 'Schedules de Discovery'],
  ['discovery.schedulePanel.oneConfigurationPerSubnetThe', 'Uma configuração por subnet. O intervalo permitido é de 1 a 168 horas.'],
  ['discovery.schedulePanel.thereAreNoSubnetsAvailable', 'Não há subnets disponíveis neste Site.'],
  ['discovery.schedulePanel.latestResult', 'Último resultado'],
  ['discovery.schedulePanel.timesShownInTheTime', 'Horas apresentadas no fuso '],
  ['discovery.schedulePanel.methods', 'Métodos'],
  ['discovery.schedulePanel.tcpPorts', 'Portas TCP'],
  ['discovery.schedulePanel.atMost64PortsBetween', 'Máximo 64 portas, entre 1 e 65535.'],
  ['discovery.schedulePanel.loadLimits', 'Limites de carga'],
  ['discovery.schedulePanel.theyApplyToEveryRun', 'Aplicam-se a todas as execuções desta subnet, manuais e agendadas. Cada ping ou ligação TCP conta como uma sonda. Vazio usa o valor predefinido (em cinzento).'],
  ['discovery.schedulePanel.resolveReverseDns', ' Resolver reverse DNS'],
  ['discovery.schedulePanel.pause', ' Pausar'],
  ['discovery.schedulePanel.enable', ' Ativar'],
  ['discovery.schedulePanel.saving', 'A guardar…'],
  ['discovery.schedulePanel.saveChanges', 'Guardar alterações'],
  ['discovery.schedulePanel.createPausedSchedule', 'Criar schedule pausado'],
  ['discovery.snmpEnrichment.couldNotSaveTheSnmp', 'Não foi possível guardar o enriquecimento SNMP.'],
  ['discovery.snmpEnrichment.snmpEnrichment', ' Enriquecimento SNMP'],
  ['discovery.snmpEnrichment.loading', 'A carregar…'],
  ['discovery.snmpEnrichment.couldNotLoadTheSnmp', 'Não foi possível consultar o enriquecimento SNMP desta subnet.'],
  ['discovery.snmpEnrichment.readCredential', 'Credencial de leitura'],
  ['discovery.snmpEnrichment.snmpEnrichmentCredential', 'Credencial SNMP de enriquecimento'],
  ['discovery.snmpEnrichment.off', 'Desligado'],
  ['discovery.snmpEnrichment.whenOnEachRunOf', 'Quando ligado, cada execução desta subnet tenta só esta credencial e só nos hosts que responderam a ping ou TCP, para ler sysObjectID, sysDescr, sysName e o modelo e número de série (ENTITY-MIB). Conta para os limites de carga da subnet.'],
  ['discovery.snmpEnrichment.thereAreNoEnabledSnmp', 'Não há credenciais SNMP de leitura ativas em equipamentos deste Site.'],
  ['discovery.snmpEnrichment.onlyAnAdminCanChange', 'Só um ADMIN pode alterar esta opção.'],
  ['discovery.snmpEnrichment.partialSnmpRead', 'Leitura SNMP parcial'],
  ['discovery.page.manualDiscovery', 'Discovery manual'],
  ['discovery.page.couldNotCreateTheDiscovery', 'Não foi possível criar a descoberta.'],
  ['discovery.page.couldNotReviewTheResult', 'Não foi possível rever o resultado.'],
  ['discovery.page.couldNotCreateThePre', 'Não foi possível criar o pré-registo.'],
  ['discovery.page.couldNotRenewThePre', 'Não foi possível renovar o pré-registo.'],
  ['discovery.page.cancelPreRegistration', 'Cancelar pré-registo'],
  ['discovery.page.cancelThisSnmpPreRegistration', 'Cancelar este pré-registo SNMP? A credencial será removida.'],
  ['discovery.page.back', 'Voltar'],
  ['discovery.page.couldNotCancelThePre', 'Não foi possível cancelar o pré-registo.'],
  ['discovery.page.cancelDiscovery', 'Cancelar descoberta'],
  ['discovery.page.cancelThisDiscoveryResultsAlready', 'Cancelar esta descoberta? Os resultados já guardados mantêm-se.'],
  ['discovery.page.couldNotUpdateTheDiscovery', 'Não foi possível atualizar a descoberta.'],
  ['discovery.page.couldNotAddTheDevice', 'Não foi possível adicionar o equipamento.'],
  ['discovery.page.refresh', ' Atualizar'],
  ['discovery.page.newDiscovery', ' Nova descoberta'],
  ['discovery.page.preRegisterIp', ' Pré-registar IP'],
  ['discovery.page.discovery', 'Descoberta'],
  ['discovery.page.searchIpIdentityOrTrap', 'Pesquisar IP, identidade ou trap…'],
  ['discovery.page.searchRuns', 'Pesquisar execuções…'],
  ['discovery.page.network', 'Rede'],
  ['discovery.page.discoveryType', 'Tipo de descoberta'],
  ['discovery.page.network2', ' Rede'],
  ['discovery.page.activeNetworkDiscoveryAndPassive', 'Descoberta ativa de rede e onboarding passivo por traps SNMP.'],
  ['discovery.page.theExecutionsCouldNotBe', 'Não foi possível carregar as execuções.'],
  ['discovery.page.appliedFilters', 'Filtros aplicados: '],
  ['discovery.page.status', 'Estado: '],
  ['discovery.page.clearFilters', ' Limpar filtros'],
  ['discovery.page.running', 'Em execução'],
  ['discovery.page.results', 'Resultados'],
  ['discovery.page.noResponse', 'Sem resposta'],
  ['discovery.page.recentRuns', 'Execuções recentes'],
  ['discovery.page.noMatchingRuns', 'Sem execuções correspondentes'],
  ['discovery.page.thereAreNoDiscoveriesYet', 'Ainda não existem descobertas'],
  ['discovery.page.probeResults', 'Resultados de sondas'],
  ['discovery.page.anIcmpReplyOrAn', 'Uma resposta ICMP ou uma porta TCP aberta é apenas evidência da sonda; não confirma a saúde do serviço ou do equipamento.'],
  ['discovery.page.cancel', ' Cancelar'],
  ['discovery.page.retry', ' Repetir'],
  ['discovery.page.changesSinceAnotherRun', 'Alterações desde outra execução'],
  ['discovery.page.comparesOnlyTheTwoSelected', 'Compara apenas as duas execuções selecionadas da mesma subnet. Hosts sem resposta são os que deixaram de aparecer entre os resultados alcançáveis.'],
  ['discovery.page.compareWith', 'Comparar com'],
  ['discovery.page.selectAnEarlierRun', 'Selecionar execução anterior'],
  ['discovery.page.thereAreNoOtherCompleted', 'Não existem outras execuções concluídas desta subnet para comparar.'],
  ['discovery.page.couldNotCompareTheseRuns', 'Não foi possível comparar estas execuções.'],
  ['discovery.page.hostObservedInTheCurrent', 'Host observado na execução atual'],
  ['discovery.page.noChanges', 'Nenhuma alteração.'],
  ['discovery.page.registeredDevices', 'Equipamentos registados'],
  ['discovery.page.waitingForATrap', 'A aguardar trap'],
  ['discovery.page.discoveredHosts', 'Hosts descobertos · '],
  ['discovery.page.devicesAvailableForSnmp', 'Equipamentos disponíveis para SNMP'],
  ['discovery.page.switchesRoutersAndFirewallsThat', 'Switches, routers e firewalls já registados podem receber configuração SNMP sem novo onboarding.'],
  ['discovery.page.noManagementIp', 'sem IP de gestão'],
  ['discovery.page.configureSnmp', ' Configurar SNMP'],
  ['discovery.page.noMatchingEquipment', 'Sem equipamentos correspondentes.'],
  ['discovery.page.thereAreNoSwitchesRouters', 'Ainda não existem switches, routers ou firewalls neste Site.'],
  ['discovery.page.trapsFromUnknownDevices', 'Traps de equipamentos desconhecidos'],
  ['discovery.page.trapsFromIpsThatWere', 'Traps de IPs que não foram pré-registados aparecem no SNMP, em Traps de equipamentos desconhecidos. '],
  ['discovery.page.waitingForTraps', 'A aguardar traps'],
  ['discovery.page.noMatchingPreRegistrations', 'Sem pré-registos correspondentes.'],
  ['discovery.page.thereAreNoIpsWaiting', 'Ainda não existem IPs a aguardar traps.'],
  ['discovery.page.discoveredHosts2', 'Hosts descobertos'],
  ['discovery.page.noMatchingCandidates', 'Sem candidatos correspondentes.'],
  ['discovery.page.noPreRegisteredDeviceHas', 'Nenhum equipamento pré-registado enviou traps.'],
  ['discovery.page.viewInSnmpUnknownTraps', 'Ver em SNMP → Traps desconhecidas'],
  ['discovery.page.addEquipment', ' Adicionar equipamento'],
  ['discovery.page.renew', ' Renovar'],
  ['discovery.page.runDiscovery', 'Executar discovery'],
  ['discovery.page.close', 'Fechar'],
  ['discovery.page.name', 'Nome'],
  ['discovery.page.selectASubnet', 'Seleciona uma subnet'],
  ['discovery.page.probeProfile', 'Perfil de sondas'],
  ['discovery.page.tcpPortsAtMost64', 'Portas TCP (máximo 64)'],
  ['discovery.page.probesShowObservedResponsesThey', 'As sondas indicam respostas observadas; não validam a saúde de serviços. Limites de rede e quantidade de portas continuam aplicados.'],
  ['discovery.page.cancel2', 'Cancelar'],
  ['discovery.page.run', 'Executar'],
  ['discovery.page.expectedIp', 'IP esperado'],
  ['discovery.page.theSourceIpOfThe', 'O IP de origem das traps, normalmente o IP de gestão do equipamento.'],
  ['discovery.page.theSharedPasswordTheSwitch', 'A palavra-passe partilhada que o switch envia em cada trap; tem de ser igual à do comando snmp-server host.'],
  ['discovery.page.theSnmpv3UserConfiguredOn', 'O utilizador SNMPv3 configurado no switch (snmp-server user).'],
  ['discovery.page.authProtocol', 'Protocolo auth'],
  ['discovery.page.privacy', 'Privacidade'],
  ['discovery.page.thePasswordThatProvesThe', 'A palavra-passe que prova que a trap vem do switch (8 ou mais caracteres).'],
  ['discovery.page.thePasswordThatEncryptsThe', 'A palavra-passe que cifra o conteúdo da trap (8 ou mais caracteres).'],
  ['discovery.page.authorizeIp', ' Autorizar IP'],
  ['discovery.page.addDiscoveredDevice', 'Adicionar equipamento descoberto'],
  ['discovery.page.deviceName', 'Nome do equipamento'],
  ['discovery.page.eGMainSwitch', 'Ex.: Switch principal'],
  ['discovery.page.hostnameOptional', 'Hostname (opcional)'],
  ['discovery.page.type', 'Tipo'],
  ['discovery.page.modelOptional', 'Modelo (opcional)'],
  ['discovery.page.noModelUseAGeneric', 'Sem modelo — usar ícone genérico'],
  ['discovery.page.theDeviceWillBeCreated', 'O equipamento será criado por localizar. O IP e a credencial TRAP serão associados automaticamente.'],
  ['discovery.results.notRecordedInIpam', 'Não registado no IPAM'],
  ['discovery.results.address', 'Endereço'],
  ['discovery.results.reverseDnsNotFound', 'reverse DNS não encontrado'],
  ['discovery.results.probe', 'Sonda'],
  ['discovery.results.revision', 'Revisão'],
  ['discovery.results.actions', 'Ações'],
  ['discovery.results.approve', ' Aprovar'],
  ['discovery.results.ignore', ' Ignorar'],
  ['discovery.results.bulkReview', 'Revisão em massa'],
  ['discovery.results.selectPendingResultsToReview', 'Seleciona resultados pendentes para rever em massa.'],
  ['discovery.results.approveSelected', ' Aprovar selecionados'],
  ['discovery.results.ignoreSelected', ' Ignorar selecionados'],
  ['discovery.results.probeResults', 'Resultados de sondas'],
  ['discovery.results.selectAllPendingResults', 'Selecionar todos os resultados pendentes'],
  ['discovery.results.noResultsMatchTheseFilters', 'Nenhum resultado com estes filtros.'],
  ['discovery.results.thereAreNoReachableResults', 'Não existem resultados alcançáveis para esta execução.'],
  ['discovery.outcomes.outcomeByMethod', 'Resultado por método'],
  ['discovery.runParts.howDiscoveryWorks', 'Como funciona a descoberta'],
  ['discovery.runParts.discover', ' Descobrir'],
  ['discovery.runParts.aRunProbesTheSubnet', 'Uma execução sonda a subnet com ICMP e portas TCP. Nada é criado no inventário.'],
  ['discovery.runParts.review', ' Rever'],
  ['discovery.runParts.eachAddressThatRespondedStays', 'Cada endereço que respondeu fica pendente. Compara com execuções anteriores e ignora o que não interessa.'],
  ['discovery.runParts.accept', ' Aceitar'],
  ['discovery.runParts.approvingCreatesTheHostThe', 'Aprovar cria o host, o IP e os serviços no IPAM. Só aí o endereço passa a fazer parte do inventário.'],
  ['discovery.runParts.forSnmpDevicesUseThe', 'Para equipamentos SNMP, usa o separador SNMP. Pré-registar um equipamento é dizer à app, antes de ele estar no inventário, de que IP vão chegar as traps e com que credenciais. O pré-registo dura 24 horas e associa as traps que chegarem desse IP. Traps de IPs não pré-registados não se perdem: '],
  ['discovery.runParts.viewInSnmpUnknownTraps', 'Ver em SNMP → Traps desconhecidas'],
  ['discovery.runParts.queued', 'Na fila'],
  ['discovery.runParts.preparing', 'A preparar'],
  ['discovery.runParts.reason', ' Motivo: '],
  ['discovery.runParts.noSite', 'sem Site'],
  ['discovery.runParts.running', ' · em curso'],
  ['discovery.status.job.pending', 'Pendente'],
  ['discovery.status.job.running', 'Em execução'],
  ['discovery.status.job.completed', 'Concluída'],
  ['discovery.status.job.failed', 'Falhada'],
  ['discovery.status.job.cancelled', 'Cancelada'],
  ['discovery.status.job.queued', 'Na fila'],
  ['discovery.status.resultCount', '3 resultados', { count: 3 }],
  ['discovery.status.error.targetNotAllowed', 'A subnet não está nas redes autorizadas para Discovery. Um administrador pode acrescentá-la nas Definições.'],
  ['discovery.status.error.targetForbidden', 'A subnet pertence a uma rede especial que não pode ser analisada.'],
  ['discovery.status.error.cidrInvalid', 'O CIDR da subnet não é válido.'],
  ['discovery.status.error.ipv6Unsupported', 'A descoberta ainda não suporta subnets IPv6.'],
  ['discovery.status.error.configurationInvalid', 'Configuração inválida: escolhe pelo menos um método e, para TCP, pelo menos uma porta.'],
  ['discovery.status.error.portLimit', 'Foram pedidas mais portas TCP do que o máximo permitido (64).'],
  ['discovery.status.error.jobNotFound', 'A execução deixou de existir.'],
  ['discovery.status.error.queueUnavailable', 'A fila de descoberta não estava disponível. Confirma que o worker e o Redis estão a correr.'],
  ['discovery.status.error.executionFailed', 'O worker falhou durante a análise depois de esgotar as tentativas.'],
  ['discovery.status.error.econnreset', 'A ligação à base de dados ou à fila foi interrompida.'],
  ['discovery.status.error.econnrefused', 'A base de dados ou a fila recusou a ligação.'],
  ['discovery.status.error.etimedout', 'A ligação à base de dados ou à fila excedeu o tempo limite.'],
  ['discovery.status.stop.cancelled', 'A execução foi cancelada.'],
  ['discovery.status.stop.limitDuration', 'A execução parou no limite de duração.'],
  ['discovery.status.stop.limitProbes', 'A execução parou no limite de sondas.'],
  ['discovery.status.failedNoReason', 'A execução falhou sem indicar o motivo.'],
  ['discovery.intervals.days', '1 dia', { count: 1 }],
  ['discovery.intervals.days', '3 dias', { count: 3 }],
  ['discovery.outcomes.icmp.reply', 'ICMP: respondeu'],
  ['discovery.outcomes.icmp.noReply', 'ICMP: sem resposta'],
  ['discovery.outcomes.icmp.error', 'ICMP: erro na sonda'],
  ['discovery.outcomes.tcp.timeout', 'sem resposta'],
  ['discovery.outcomes.snmp.ok', 'SNMP: lido'],
  ['discovery.outcomes.snmp.partial', 'SNMP: leitura parcial'],
  ['discovery.outcomes.snmp.authFailed', 'SNMP: autenticação falhou'],
  ['discovery.outcomes.snmp.timeout', 'SNMP: sem resposta'],
  ['discovery.outcomes.snmp.error', 'SNMP: erro'],
  ['discovery.outcomes.snmp.skippedPolicy', 'SNMP: não tentado (política da execução)'],
  ['discovery.outcomes.dns.ptr', 'DNS: registo PTR encontrado'],
  ['discovery.outcomes.dns.noPtr', 'DNS: sem registo PTR'],
  ['discovery.outcomes.tcpLine', 'TCP 4: 5', { port: 4, state: 5 }],
  ['discovery.outcomes.summary.hosts', 'Hosts: 4 responderam · 5 sem resposta · 6 não sondados', { responded: 4, noResponse: 5, notScanned: 6 }],
  ['discovery.outcomes.summary.icmp', 'ICMP: 4 respostas · 5 sem resposta · 6 erros', { reply: 4, noReply: 5, error: 6 }],
  ['discovery.outcomes.summary.tcp', 'Portas TCP: 4 abertas · 5 recusadas · 6 sem resposta · 7 erros', { open: 4, refused: 5, timeout: 6, error: 7 }],
  ['discovery.outcomes.summary.dns', 'DNS inverso: 4 com PTR · 5 sem PTR · 6 falhas', { ptr: 4, noPtr: 5, failed: 6 }],
  ['discovery.outcomes.summary.snmp', 'SNMP: 4 lidos · 5 parciais · 6 autenticação falhou · 7 sem resposta · 8 erros · 9 não tentados (política)', { ok: 4, partial: 5, authFailed: 6, timeout: 7, error: 8, skipped: 9 }],
  ['discovery.snmpEnrichment.failure.authFailed', 'Autenticação SNMP falhou'],
  ['discovery.snmpEnrichment.failure.timeout', 'SNMP sem resposta'],
  ['discovery.snmpEnrichment.failure.error', 'Erro SNMP'],
  ['discovery.snmpEnrichment.skip.credentialUnavailable', 'a credencial já não existe, não é de leitura ou está desativada'],
  ['discovery.snmpEnrichment.skip.credentialOutOfScope', 'a credencial já não pertence a um equipamento do Site da subnet'],
  ['discovery.snmpEnrichment.skip.v2cDisabled', 'o SNMPv2c está desativado neste servidor'],
  ['discovery.snmpEnrichment.skip.keyringUnavailable', 'o keyring SNMP não está disponível no servidor'],
  ['discovery.snmpEnrichment.runSkipped', 'Enriquecimento SNMP não executado: 4.', { reason: 4 }],
  ['discovery.snmpEnrichment.runSummary', 'Enriquecimento SNMP: 4 hosts lidos · 5 sem leitura', { enriched: 4, failed: 5 }],
  ['discovery.results.chip.review.pending', 'Pendentes'],
  ['discovery.results.chip.review.approved', 'Aprovados'],
  ['discovery.results.chip.review.ignored', 'Ignorados'],
  ['discovery.results.chip.ipam.free', 'Livres'],
  ['discovery.results.chip.ipam.occupied', 'Ocupados'],
  ['discovery.results.chip.ipam.reserved', 'Reservados'],
  ['discovery.results.chip.ipam.excluded', 'Excluídos'],
  ['discovery.results.chip.ipam.none', 'Fora do IPAM'],
  ['discovery.results.reservedUntil', 'Reservado até 4', { time: 4 }],
  ['discovery.results.approveNamed', 'Aprovar 4', { address: 4 }],
  ['discovery.results.ignoreNamed', 'Ignorar 4', { address: 4 }],
  ['discovery.results.selectedCount', '3 selecionados', { count: 3 }],
  ['discovery.page.tab.network', 'Rede'],
  ['discovery.page.tab.snmp', 'SNMP'],
];

// Keys whose English the source-text table left in Portuguese; the keyed English fixes it.
const fixedEnglish: Array<[key: string, portuguese: string, english: string, params?: Params]> = [
  ['discovery.page.expires', ' · expira ', ' · expires '],
  ['discovery.page.preRegisterSnmpDevice', 'Pré-registar equipamento SNMP', 'Pre-register SNMP device'],
  ['discovery.status.resultCount', '1 resultado', '1 result', { count: 1 }],
  ['discovery.outcomes.tcp.open', 'aberta', 'open'],
  ['discovery.outcomes.tcp.refused', 'recusada', 'refused'],
  ['discovery.outcomes.tcp.error', 'erro', 'error'],
  ['discovery.outcomes.dns.lookupFailed', 'DNS: pesquisa falhou (4)', 'DNS: lookup failed (4)', { error: 4 }],
  ['discovery.schedulePanel.localTimeZone', 'fuso local', 'local time zone'],
];

/** Every non-test source file of the Discovery feature folder, nested folders included. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}
const sources = sourceFiles(__dirname).map((path) => readFileSync(path, 'utf8'));

describe('discovery keyed messages', () => {
  it.each(keyed)('%s renders the same Portuguese and English as before', (key, portuguese, params) => {
    expect(translateMessage('pt-PT', key, undefined, params)).toBe(portuguese);
    expect(translateMessage('en-US', key, undefined, params)).toBe(translateSourceText('en-US', portuguese));
  });

  it.each(fixedEnglish)('%s keeps the Portuguese and gets real English', (key, portuguese, english, params) => {
    expect(translateMessage('pt-PT', key, undefined, params)).toBe(portuguese);
    expect(translateMessage('en-US', key, undefined, params)).toBe(english);
  });

  it('covers every key the Discovery components use, in both locales and the added languages', () => {
    const used = new Set(sources.flatMap((source) => [...source.matchAll(/'(discovery\.[\w.]+)'/g)].map((match) => match[1])));
    const listed = new Set([...keyed, ...fixedEnglish].map(([key]) => key));
    expect([...used].sort()).toEqual([...listed].sort());
    for (const key of listed) {
      for (const locale of ['pt-PT', 'en-US'] as AppLocale[]) expect(translateMessage(locale, key, '∅', { count: 3 })).not.toBe('∅');
    }
    for (const key of Object.keys(ptPT)) {
      for (const bundle of [esES, frFR, deDE, itIT]) expect(bundle[key], key).toBeTruthy();
    }
  });

  it('leaves no Portuguese literal in the Discovery components', () => {
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

const outcome = { icmp: 'REPLY', tcp: [{ port: 22, state: 'OPEN' }], dns: 'PTR', snmp: 'NOT_ENABLED' } as DiscoveryHostOutcome;

describe('Discovery screens follow the active language', () => {
  it('renders a host outcome in English and in Portuguese', () => {
    render(<DiscoveryOutcomeCell outcome={outcome} />);
    expect(screen.getByText('ICMP: replied')).toBeTruthy();
    expect(screen.getByText('TCP 22: open')).toBeTruthy();
    expect(screen.getByText('DNS: PTR record found')).toBeTruthy();
    cleanup();
    locale.current = 'pt-PT';
    render(<DiscoveryOutcomeCell outcome={outcome} />);
    expect(screen.getByText('ICMP: respondeu')).toBeTruthy();
    expect(screen.getByText('TCP 22: aberta')).toBeTruthy();
  });
});
