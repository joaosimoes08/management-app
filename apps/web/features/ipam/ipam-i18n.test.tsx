import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateMessage, type AppLocale } from '@/lib/i18n/i18n';
import { translateSourceText } from '@/lib/i18n/source-text-messages';
import { messages as deDE } from '@/lib/i18n/messages/ipam/de-DE';
import { messages as esES } from '@/lib/i18n/messages/ipam/es-ES';
import { messages as frFR } from '@/lib/i18n/messages/ipam/fr-FR';
import { messages as itIT } from '@/lib/i18n/messages/ipam/it-IT';
import { messages as ptPT } from '@/lib/i18n/messages/ipam/pt-PT';

// The IPAM screens (subnets, VLAN map, VRFs, NAT, RIPE import, hosts and IPs) moved from hard-coded
// Portuguese (translated on the page from source-text-messages.ts) to keyed messages. Each key must
// render exactly what the old Portuguese source showed, and en-US exactly what the source-text table made of it.
const keyed: Array<[key: string, portuguese: string, params?: Record<string, string | number>]> = [
  ['ipam.state.ip.FREE', 'Livre'],
  ['ipam.state.ip.OCCUPIED', 'Ocupado'],
  ['ipam.state.ip.RESERVED', 'Reservado'],
  ['ipam.state.ip.EXCLUDED', 'Excluído'],
  ['ipam.state.ip.UNKNOWN', 'Desconhecido'],
  ['ipam.state.ip.REACHABLE', 'Acessível'],
  ['ipam.state.ip.UNREACHABLE', 'Inacessível'],
  ['ipam.state.host.UNKNOWN', 'Desconhecido'],
  ['ipam.state.host.ACTIVE', 'Ativo'],
  ['ipam.state.host.INACTIVE', 'Inativo'],
  ['ipam.state.host.MAINTENANCE', 'Manutenção'],
  ['ipam.state.host.RETIRED', 'Retirado'],
  ['ipam.state.open', 'Aberto'],
  ['ipam.state.sourceManual', 'Manual'],
  ['ipam.utilization.filter.OK', 'Normal'],
  ['ipam.utilization.filter.WARNING', 'Atenção (≥ 80%)'],
  ['ipam.utilization.filter.CRITICAL', 'Crítica (≥ 90%)'],
  ['ipam.utilization.filter.UNTRACKED', 'Não contabilizada (IPv6)'],
  ['ipam.permissionsView.clearTitle', 'Apagar permissões'],
  ['ipam.permissionsView.clearConfirm', 'Apagar todas as permissões IPAM deste grupo nos Sites selecionados?'],
  ['ipam.permissionsView.clearButton', 'Apagar'],
  ['ipam.mapView.newVlan', 'Nova VLAN'],
  ['ipam.mapView.empty.title', 'Este Site ainda não tem VLANs'],
  ['ipam.mapView.empty.text', 'Cria a tua primeira VLAN para começares.'],
  ['ipam.mapView.editVlan', 'Editar VLAN'],
  ['ipam.mapView.deleteVlan', 'Eliminar VLAN'],
  ['ipam.mapView.configured', 'Configurada'],
  ['ipam.mapView.noSubnet', 'Sem subnet'],
  ['ipam.mapView.primarySubnet', 'Subnet principal'],
  ['ipam.mapView.createSubnet', 'Criar subnet'],
  ['ipam.mapView.noSubnetConfigured', 'Sem subnet configurada'],
  ['ipam.mapView.devicesAndPorts', 'Equipamentos e portas'],
  ['ipam.mapView.linkedInterfaces', 'Interfaces associadas'],
  ['ipam.subnetsView.utilization', 'Utilização'],
  ['ipam.subnetsView.noData', 'Sem dados'],
  ['ipam.subnetsView.tagFilter', 'Etiqueta'],
  ['ipam.subnetsView.all', 'Todas'],
  ['ipam.subnetsView.title', 'Subnets do Site'],
  ['ipam.subnetsView.empty.tagTitle', 'Sem subnets com esta etiqueta'],
  ['ipam.subnetsView.empty.tagText', 'Escolhe outra etiqueta ou limpa o filtro.'],
  ['ipam.subnetsView.empty.bandTitle', 'Sem subnets nesta faixa de utilização'],
  ['ipam.subnetsView.empty.bandText', 'Escolhe outra faixa ou limpa o filtro.'],
  ['ipam.subnetsView.new', 'Nova subnet'],
  ['ipam.subnetsView.loading', 'A carregar subnets'],
  ['ipam.subnetsView.empty.noMatch', 'Sem subnets correspondentes'],
  ['ipam.subnetsView.empty.title', 'Este Site ainda não tem subnets'],
  ['ipam.subnetsView.empty.text', 'Cria uma subnet diretamente nesta página.'],
  ['ipam.subnetsView.back', '← Todas as subnets'],
  ['ipam.subnetsView.nextFree', 'Próximo IP livre'],
  ['ipam.subnetsView.newIp', 'Novo endereço IP'],
  ['ipam.subnetsView.hostsAndIps', 'Hosts e endereços IP'],
  ['ipam.subnetsView.ipsLabel', 'Endereços IP da subnet'],
  ['ipam.subnetsView.col.state', 'Estado manual / observado'],
  ['ipam.subnetsView.reservedUntil', 'Até 23/11/2026, 15:00', { date: '23/11/2026, 15:00' }],
  ['ipam.subnetsView.release', 'Libertar'],
  ['ipam.subnetsView.reserve', 'Reservar'],
  ['ipam.subnetsView.pagesLabel', 'Páginas dos endereços IP'],
  ['ipam.subnetsView.previousPage', 'Página anterior'],
  ['ipam.subnetsView.nextPage', 'Página seguinte'],
  ['ipam.subnetsView.empty.noIpMatch', 'Sem IPs correspondentes'],
  ['ipam.subnetsView.empty.noIps', 'Ainda não existem endereços nesta subnet'],
  ['ipam.common.noHostname', 'Sem hostname'],
  ['ipam.common.stateLabel', 'Estado:'],
  ['ipam.common.observedLabel', 'Observado:'],
  ['ipam.common.cancel', 'Cancelar'],
  ['ipam.common.operationDone', 'Operação concluída.'],
  ['ipam.ipView.address', 'Endereço IP'],
  ['ipam.ipView.never', 'Nunca'],
  ['ipam.ipView.edit', 'Editar IP'],
  ['ipam.ipView.history', 'Histórico de verificações'],
  ['ipam.ipView.noResponse', 'Sem resposta'],
  ['ipam.ipView.system', 'Sistema'],
  ['ipam.hostView.editTitle', 'Editar Host'],
  ['ipam.hostView.createServiceTitle', 'Criar Service'],
  ['ipam.hostView.serviceName', 'Nome do serviço'],
  ['ipam.hostView.port', 'Porta'],
  ['ipam.hostView.label', 'Ficha do Host'],
  ['ipam.hostView.sourceLabel', 'Origem:'],
  ['ipam.hostView.os', 'SO'],
  ['ipam.hostView.deviceLocation', 'Device / localização'],
  ['ipam.hostView.notLinked', 'Não associado'],
  ['ipam.hostView.edit', 'Editar'],
  ['ipam.hostView.retireTitle', 'Retirar Host'],
  ['ipam.hostView.retireConfirm', 'Retirar este Host?'],
  ['ipam.hostView.retire', 'Retirar'],
  ['ipam.hostView.relations', 'IPs, VLANs, subnets e interfaces'],
  ['ipam.hostView.noInterface', 'Sem interface associada'],
  ['ipam.hostView.unlinkIp', 'Desassociar IP'],
  ['ipam.hostView.deleteService', 'Eliminar Service'],
  ['ipam.vrfsView.editTitle', 'Editar VRF'],
  ['ipam.vrfsView.createTitle', 'Criar VRF'],
  ['ipam.vrfsView.deleteTitle', 'Eliminar VRF'],
  ['ipam.vrfsView.natRules', 'Regras NAT'],
  ['ipam.vrfsView.title', 'VRFs do Site'],
  ['ipam.vrfsView.description', 'Instâncias de routing do Site e as subnets que pertencem a cada uma.'],
  ['ipam.vrfsView.new', 'Novo VRF'],
  ['ipam.vrfsView.empty.noMatch', 'Sem VRFs correspondentes'],
  ['ipam.vrfsView.empty.title', 'Este Site ainda não tem VRFs'],
  ['ipam.vrfsView.empty.canCreate', 'Cria um VRF para separar tabelas de routing neste Site.'],
  ['ipam.vrfsView.empty.readOnly', 'Ainda não foram configurados VRFs neste Site.'],
  ['ipam.vrfsView.noRd', 'Sem route distinguisher'],
  ['ipam.vrfsView.subnetsHere', 'Subnets neste VRF'],
  ['ipam.vrfsView.noSubnets', 'Ainda não existem subnets neste VRF. Associa uma subnet ao VRF ao criá-la ou editá-la no separador Subnets.'],
  ['ipam.vrfsView.rdHelp', 'Formato ASN:número ou IP:número, por exemplo 65000:100.'],
  ['ipam.common.operationFailed', 'Operação falhou.'],
  ['ipam.common.changesSaved', 'As alterações foram guardadas.'],
  ['ipam.common.name', 'Nome'],
  ['ipam.common.type', 'Tipo'],
  ['ipam.common.status', 'Estado'],
  ['ipam.common.actions', 'Ações'],
  ['ipam.common.description', 'Descrição'],
  ['ipam.common.noVrf', 'Sem VRF'],
  ['ipam.common.noVlan', 'Sem VLAN'],
  ['ipam.common.saving', 'A guardar…'],
  ['ipam.common.save', 'Guardar'],
  ['ipam.common.saveChanges', 'Guardar alterações'],
  ['ipam.common.close', 'Fechar'],
  ['ipam.reserveForm.duration', 'Duração'],
  ['ipam.reserveForm.hours4', '4 horas'],
  ['ipam.reserveForm.hours24', '24 horas (predefinição)'],
  ['ipam.reserveForm.days3', '3 dias'],
  ['ipam.reserveForm.days7', '7 dias'],
  ['ipam.reserveForm.custom', 'Personalizada'],
  ['ipam.reserveForm.customHours', 'Duração personalizada em horas'],
  ['ipam.reserveForm.reason', 'Motivo'],
  ['ipam.reserveForm.cancel', 'Cancelar'],
  ['ipam.reserveForm.reserving', 'A reservar…'],
  ['ipam.reserveForm.durationRange', 'Escolhe uma duração entre 1 hora e 30 dias.'],
  ['ipam.natView.title', 'Regras NAT do Site'],
  ['ipam.natView.description', 'Traduções entre endereços internos e externos, por tipo e VRF.'],
  ['ipam.natView.createTitle', 'Criar regra NAT'],
  ['ipam.natView.editTitle', 'Editar regra NAT'],
  ['ipam.natView.deleteTitle', 'Eliminar regra NAT'],
  ['ipam.natView.new', 'Nova regra NAT'],
  ['ipam.natView.col.addresses', 'Interno ↔ Externo'],
  ['ipam.natView.destinationPortValue', 'porta de destino 8443', { port: 8443 }],
  ['ipam.natView.protocol', 'Protocolo'],
  ['ipam.natView.anyProtocol', 'Qualquer'],
  ['ipam.natView.enabled', 'Ativa'],
  ['ipam.natView.disabled', 'Desativada'],
  ['ipam.natView.allTypes', 'Todos os tipos'],
  ['ipam.natView.allVrfs', 'Todos os VRFs'],
  ['ipam.natView.empty.filteredTitle', 'Sem regras NAT correspondentes'],
  ['ipam.natView.empty.title', 'Este Site ainda não tem regras NAT'],
  ['ipam.natView.empty.filteredText', 'Experimenta outra pesquisa ou limpa os filtros.'],
  ['ipam.natView.empty.canCreate', 'Cria a primeira regra NAT deste Site.'],
  ['ipam.natView.empty.readOnly', 'Ainda não foram configuradas regras NAT neste Site.'],
  ['ipam.natView.insideAddress', 'Endereço interno'],
  ['ipam.natView.insidePort', 'Porta interna'],
  ['ipam.natView.outsideAddress', 'Endereço externo'],
  ['ipam.natView.outsidePort', 'Porta externa'],
  ['ipam.natView.destinationPort', 'Porta de destino'],
  ['ipam.natView.insideSubnet', 'Subnet interna'],
  ['ipam.natView.noSubnet', 'Sem subnet associada'],
  ['ipam.natView.active', 'Regra ativa'],
  ['ipam.nextFreeModal.rangeChanged', 'Os IPs livres mudaram entretanto. A lista foi atualizada; revê-a e tenta novamente.'],
  ['ipam.nextFreeModal.ipv4Only', 'A reserva automática só está disponível para subnets IPv4.'],
  ['ipam.nextFreeModal.reserveError', 'Não foi possível reservar IPs nesta subnet.'],
  ['ipam.nextFreeModal.searchLabel', 'Procurar IPs livres'],
  ['ipam.nextFreeModal.description', 'Procura os próximos endereços livres da subnet. Indica um intervalo para limitar a pesquisa.'],
  ['ipam.nextFreeModal.count', 'Quantidade'],
  ['ipam.nextFreeModal.from', 'A partir de'],
  ['ipam.nextFreeModal.to', 'Até'],
  ['ipam.nextFreeModal.searching', 'A procurar…'],
  ['ipam.nextFreeModal.search', 'Procurar'],
  ['ipam.nextFreeModal.searchError', 'Não foi possível procurar IPs livres.'],
  ['ipam.nextFreeModal.unsupported', 'A pesquisa de IPs livres não é suportada nesta subnet.'],
  ['ipam.nextFreeModal.none', 'Não há IPs livres neste intervalo.'],
  ['ipam.nextFreeModal.foundLabel', 'IPs livres encontrados'],
  ['ipam.nextFreeModal.col.tracked', 'Registo IPAM'],
  ['ipam.nextFreeModal.tracked', 'Registado como livre'],
  ['ipam.nextFreeModal.untracked', 'Ainda não registado'],
  ['ipam.nextFreeModal.reserveLabel', 'Reservar IPs livres'],
  ['ipam.nextFreeModal.reserveHint', 'A reserva é feita no servidor: se os IPs mudarem entretanto, nada é reservado e a lista é atualizada.'],
  ['ipam.ripeView.status.new', 'Novo'],
  ['ipam.ripeView.status.changed', 'Alterado'],
  ['ipam.ripeView.status.exists', 'Já existe'],
  ['ipam.ripeView.status.conflict', 'Conflito'],
  ['ipam.ripeView.reason.NEW', 'Prefixo novo: será criado como subnet.'],
  ['ipam.ripeView.reason.NEW_OVERLAPS_OTHER_SCOPE', 'Prefixo novo: sobrepõe subnets de outro Site ou VRF, o que é permitido.'],
  ['ipam.ripeView.reason.EXISTS_SAME', 'Já existe neste Site com os mesmos atributos.'],
  ['ipam.ripeView.reason.EXISTS_DIFFERENT_ATTRIBUTES', 'Já existe neste Site com atributos diferentes; a importação não altera subnets existentes.'],
  ['ipam.ripeView.reason.OVERLAP', 'Sobrepõe uma subnet existente no mesmo Site/VRF.'],
  ['ipam.ripeView.reason.EXISTS_OUTSIDE_SITE', 'Já existe noutro Site ou sem Site; os CIDR são únicos na aplicação.'],
  ['ipam.ripeView.prefix', 'Prefixo'],
  ['ipam.ripeView.organisation', 'Organização'],
  ['ipam.ripeView.pastedList', 'Lista colada'],
  ['ipam.ripeView.pasteOverlap', 'Sobrepõe um prefixo anterior desta lista no mesmo Site/VRF; só o primeiro é importado.'],
  ['ipam.ripeView.hiddenValues', 'Os valores atuais estão ocultos: sem acesso de leitura a esta subnet.'],
  ['ipam.ripeView.col.query', 'Consulta'],
  ['ipam.ripeView.col.outcome', 'Criadas / ignoradas'],
  ['ipam.ripeView.col.result', 'Resultado'],
  ['ipam.ripeView.col.detail', 'Detalhe'],
  ['ipam.ripeView.prefixes', 'Prefixos'],
  ['ipam.ripeView.title', 'Importação RIPE'],
  ['ipam.ripeView.notAllowed', 'A pré-visualização e importação RIPE estão disponíveis apenas para ADMIN e NETWORK_OPERATOR.'],
  ['ipam.ripeView.importTitle', 'Importar prefixos RIPE'],
  ['ipam.ripeView.import', 'Importar'],
  ['ipam.ripeView.targetVrf', 'VRF de destino'],
  ['ipam.ripeView.targetHint', 'As diferenças são calculadas para este Site e VRF.'],
  ['ipam.ripeView.description', 'Consulta o RIPEstat ou cola uma lista de prefixos, revê as diferenças calculadas pelo servidor e confirma a importação.'],
  ['ipam.ripeView.pasteButton', 'Colar ou carregar lista'],
  ['ipam.ripeView.ripestatQuery', 'Consulta RIPEstat'],
  ['ipam.ripeView.autoDetect', 'Detetar automaticamente'],
  ['ipam.ripeView.previewing', 'A pré-visualizar…'],
  ['ipam.ripeView.preview', 'Pré-visualizar'],
  ['ipam.ripeView.stale', 'O Site ou o VRF de destino mudou depois da pré-visualização. Pré-visualiza novamente para atualizar as diferenças antes de importar.'],
  ['ipam.ripeView.invalidBadge', 'Inválido'],
  ['ipam.ripeView.invalid.missingLength', 'Falta o comprimento do prefixo (por exemplo /24).'],
  ['ipam.ripeView.invalid.notCidr', 'Não é um prefixo IPv4/IPv6 válido em notação CIDR.'],
  ['ipam.ripeView.noPrefixes', 'Sem prefixos'],
  ['ipam.ripeView.noPrefixesText', 'A consulta não devolveu prefixos.'],
  ['ipam.ripeView.importing', 'A importar…'],
  ['ipam.ripeView.noImportPermission', 'Não tens permissão IMPORT neste Site: podes rever a pré-visualização, mas não importar.'],
  ['ipam.ripeView.history.title', 'Histórico de importações'],
  ['ipam.ripeView.history.description', 'As 50 consultas e importações RIPE mais recentes.'],
  ['ipam.ripeView.history.label', 'Histórico de importações RIPE'],
  ['ipam.ripeView.history.noMatch', 'Sem importações correspondentes'],
  ['ipam.ripeView.history.empty', 'Ainda não existem importações RIPE'],
  ['ipam.ripeView.history.emptyText', 'As pré-visualizações e importações aparecem aqui.'],
  ['ipam.ripeView.pasteTitle', 'Colar ou carregar prefixos'],
  ['ipam.ripeView.pasteHelp', 'Um ou mais prefixos CIDR separados por linhas, espaços, vírgulas ou ponto e vírgula. Máximo 500.'],
  ['ipam.ripeView.fileLabel', 'Ficheiro .txt ou .csv'],
  ['ipam.ripeView.detail.selected', 'Selecionados'],
  ['ipam.ripeView.detail.created', 'Subnets criadas'],
  ['ipam.ripeView.detail.skipped', 'Ignorados'],
  ['ipam.ripeView.detail.skippedPrefixes', 'Prefixos ignorados'],
  ['ipam.ripeView.detail.selectedPrefix', 'Selecionado para importação'],
  ['ipam.ripeView.detail.notSelected', 'Não selecionado'],
  ['ipam.ripeView.detail.noPrefixes', 'Sem prefixos nesta consulta.'],
  ['ipam.ripeView.detail.invalidEntries', 'Entradas inválidas'],
  ['ipam.ipamPage.openSubnetError', 'Não foi possível abrir a subnet.'],
  ['ipam.ipamPage.chooseSite', 'Seleciona um Site'],
  ['ipam.ipamPage.detachTitle', 'Desassociar subnet'],
  ['ipam.ipamPage.detach', 'Desassociar'],
  ['ipam.ipamPage.calcError', 'Não foi possível calcular as subnets.'],
  ['ipam.ipamPage.search.ips', 'Pesquisar IP ou hostname…'],
  ['ipam.ipamPage.search.map', 'Pesquisar VLAN ou subnet…'],
  ['ipam.ipamPage.search.vrfs', 'Pesquisar VRF ou route distinguisher…'],
  ['ipam.ipamPage.search.nat', 'Pesquisar regra NAT ou endereço…'],
  ['ipam.ipamPage.search.imports', 'Pesquisar importações RIPE…'],
  ['ipam.ipamPage.search.planning', 'Pesquisar subnet, VRF ou Site…'],
  ['ipam.ipamPage.search.subnets', 'Pesquisar subnets…'],
  ['ipam.ipamPage.ipAddresses', 'Endereços IP'],
  ['ipam.ipamPage.refresh', 'Atualizar'],
  ['ipam.ipamPage.backToPort', '← Voltar à porta'],
  ['ipam.ipamPage.filtersError', 'Não foi possível aplicar os filtros.'],
  ['ipam.ipamPage.filtersApplied', 'Filtros aplicados:'],
  ['ipam.ipamPage.clearFilters', 'Limpar filtros'],
  ['ipam.ipamPage.noSite.title', 'Escolhe um Site para começar'],
  ['ipam.ipamPage.noSite.text', 'O mapa mostra as VLANs e subnets do Site selecionado.'],
  ['ipam.ipamPage.refreshError', 'Não foi possível atualizar os dados de IPAM'],
  ['ipam.ipamPage.releaseError', 'Não foi possível libertar a reserva'],
  ['ipam.ipamPage.ipamOperation', 'Operação IPAM'],
  ['ipam.ipamPage.comingSoon', 'Esta área do IPAM está preparada para a próxima configuração.'],
  ['ipam.ipamPage.device', 'Equipamento'],
  ['ipam.ipamPage.noMode', 'sem modo'],
  ['ipam.ipamPage.noInterfaces.title', 'Sem interfaces associadas'],
  ['ipam.ipamPage.noInterfaces.text', 'Esta VLAN ainda não está associada a portas de equipamentos.'],
  ['ipam.ipamPage.createHostTitle', 'Criar Host e associar IP'],
  ['ipam.ipamPage.operatingSystem', 'Sistema operativo'],
  ['ipam.ipamPage.notes', 'Notas'],
  ['ipam.ipamPage.createAndLink', 'Criar e associar'],
];

// These showed Portuguese (or a wrong word) in English before: the source-text table had no entry for the
// built text, only for a fragment ("Até" became "To"). They now have a real translation.
const untranslatedBefore = new Set([
  'ipam.hostView.os',
  'ipam.natView.destinationPortValue',
  'ipam.subnetsView.reservedUntil',
]);
const sourceFiles = [
  'components/central-permissions.tsx',
  'components/host-panel.tsx',
  'components/ip-address-panel.tsx',
  'components/ip-reservation-modal.tsx',
  'components/nat-view.tsx',
  'components/network-map.tsx',
  'components/next-free-ip-modal.tsx',
  'components/ripe-view.tsx',
  'components/subnets-view.tsx',
  'components/vrfs-view.tsx',
  'ip-state.ts',
  'ipam-page.tsx',
  'utilization.ts',
];
const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');
const domainKeys = new Set(Object.keys(ptPT));

describe('ipam keyed messages', () => {
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

  it('covers every key the IPAM screens use, in both locales and the added languages', () => {
    const source = sourceFiles.map(read).join('\n');
    const all = new Set(keyed.map(([key]) => key));
    expect([...domainKeys].sort()).toEqual([...all].sort());
    // The screens also use older ipam.* keys from i18n.tsx and tags.* keys: every key they name must resolve.
    const named = new Set([...source.matchAll(/'((?:ipam|tags)\.[\w.]+)'/g)].map((match) => match[1]));
    for (const key of named) {
      const resolves = translateMessage('pt-PT', key, '∅') !== '∅' || translateMessage('pt-PT', `${key}.other`, '∅') !== '∅';
      expect(resolves, key).toBe(true);
    }
    // Keys built from a value: IP and host states, utilisation filter bands.
    const prefixes = [...new Set([...source.matchAll(/`(ipam\.[\w.]+\.)\$\{/g)].map((match) => match[1]))]
      .filter((prefix) => [...all].some((key) => key.startsWith(prefix))).sort();
    expect(prefixes).toEqual(['ipam.state.host.', 'ipam.state.ip.', 'ipam.utilization.filter.']);
    const used = new Set([...named].filter((key) => all.has(key)));
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
    expect(source).not.toMatch(/['"`>]\s*(Guardar|Cancelar|Fechar|Eliminar|Editar|Criar|Nova|Novo|Sem|Todas|Todos|Libertar|Reservar|Retirar|Apagar|Nome|Estado|Notas|Porta|Motivo|Nunca|Livre|Ocupado|Reservado|Ativo|Inativo|Importar|Procurar|Pesquisar|Atualizar|Desassociar|Quantidade|Prefixo|Consulta)\b/);
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

const { IpReservationModal } = await import('./components/ip-reservation-modal');
const { NetworkMap } = await import('./components/network-map');
const ip = { id: 'ip-1', address: '192.0.2.18', subnetId: 'subnet-1', state: 'FREE' } as never;
const noop = () => undefined;
const screens = () => <>
  <IpReservationModal ip={ip} close={noop} submit={async () => undefined} />
  <NetworkMap vlans={[]} canEdit={false} newVlan={noop} newSubnet={noop} edit={noop} remove={noop} associate={noop} detachSubnet={noop} openSubnet={noop} />
</>;

afterEach(() => { cleanup(); locale.current = 'en-US'; });

describe('IPAM screens follow the active language', () => {
  it('renders the reservation form and the empty VLAN map in English', () => {
    render(screens());
    expect(screen.getByLabelText(translateSourceText('en-US', 'Motivo'))).toBeTruthy();
    expect(screen.getByRole('option', { name: translateSourceText('en-US', '24 horas (predefinição)') })).toBeTruthy();
    expect(screen.getByRole('button', { name: translateSourceText('en-US', 'Cancelar') })).toBeTruthy();
    expect(screen.getByText(translateSourceText('en-US', 'Este Site ainda não tem VLANs'))).toBeTruthy();
    expect(screen.queryByText('Motivo')).toBeNull();
    expect(screen.queryByText('Este Site ainda não tem VLANs')).toBeNull();
  });

  it('renders the same screens in Portuguese', () => {
    locale.current = 'pt-PT';
    render(screens());
    expect(screen.getByLabelText('Motivo')).toBeTruthy();
    expect(screen.getByRole('option', { name: '24 horas (predefinição)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(screen.getByText('Este Site ainda não tem VLANs')).toBeTruthy();
    expect(screen.getByText('Cria a tua primeira VLAN para começares.')).toBeTruthy();
  });
});
