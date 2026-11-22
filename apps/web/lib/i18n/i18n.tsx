'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { translateLegacyText } from './legacy-messages';
import { getConfiguredLocale, hasSavedOrganizationLocale } from '@/lib/runtime-config';
import { setFormatLocale } from '@/lib/format/date';

export type AppLocale = 'pt-PT' | 'en-US';
const messages: Record<AppLocale, Record<string, string>> = {
  'pt-PT': {
    'capacity.title': 'Capacidade',
    'capacity.resource': 'Recurso',
    'capacity.current': 'Utilização',
    'capacity.trend': 'Tendência / 30 dias',
    'capacity.estimateAt': 'Estimativa a {threshold}',
    'capacity.estimate': 'Estimativa',
    'capacity.refresh': 'Atualizar',
    'capacity.filter': 'Tipo de recurso',
    'capacity.all': 'Todos os tipos',
    'capacity.thresholds': 'Aviso a {warning} · Crítico a {critical}',
    'capacity.failed': 'Não foi possível carregar a capacidade do Site.',
    'capacity.empty': 'Nenhum recurso de capacidade para este filtro.',
    'capacity.method': 'Tendência dos últimos {days} dias de dados com capacidade comparável, em pontos percentuais (pp). Estimativas até 12 meses. A energia usa consumo estimado.',
    'capacity.points': '{amount} pp',
    'capacity.observed': 'Medido em {date}',
    'capacity.kind.SUBNET': 'Subnet',
    'capacity.kind.NETAPP_VOLUME': 'Volume NetApp',
    'capacity.kind.NETAPP_AGGREGATE': 'Agregado NetApp',
    'capacity.kind.RACK_SPACE': 'Espaço no bastidor',
    'capacity.kind.RACK_POWER': 'Energia do bastidor',
    'capacity.kind.PDU_POWER': 'Energia da PDU',
    'capacity.status.INSUFFICIENT': 'Dados insuficientes',
    'capacity.status.ALREADY_AT_THRESHOLD': 'No limiar ou acima',
    'capacity.status.NO_GROWTH': 'Sem crescimento',
    'capacity.status.BEYOND_HORIZON': 'Para além de 12 meses',
    'capacity.level.ok': 'Normal',
    'capacity.level.warning': 'Aviso',
    'capacity.level.critical': 'Crítico',
    'linuxHosts.scrollColumns': 'Desliza para ver mais colunas.',
    'linuxHosts.firstColumns': 'Mostrar primeiras colunas',
    'linuxHosts.lastColumns': 'Mostrar últimas colunas',
    'linuxHosts.title': 'Servidores',
    'linuxHosts.description': 'Consulta os hosts, os serviços e o estado dos agentes Linux.',
    'linuxHosts.site': 'Site',
    'linuxHosts.allSites': 'Todos os Sites',
    'linuxHosts.state': 'Estado do agente',
    'linuxHosts.allStates': 'Todos os estados',
    'linuxHosts.state.ONLINE': 'Online',
    'linuxHosts.state.STALE': 'Atrasado',
    'linuxHosts.state.NONE': 'Sem agente',
    'linuxHosts.state.REVOKED': 'Revogado',
    'linuxHosts.name': 'Nome',
    'linuxHosts.hostname': 'Hostname',
    'linuxHosts.os': 'Sistema operativo',
    'linuxHosts.device': 'Equipamento associado',
    'linuxHosts.ips': 'Endereços IP',
    'linuxHosts.heartbeat': 'Último heartbeat',
    'linuxHosts.agentVersion': 'Versão do agente',
    'linuxHosts.actions': 'Ações',
    'linuxHosts.threshold': 'Um agente fica atrasado após {minutes} min sem heartbeat.',
    'linuxHosts.empty': 'Nenhum servidor corresponde aos filtros.',
    'linuxHosts.loadError': 'Não foi possível carregar os servidores.',
    'linuxHosts.services': 'Serviços',
    'linuxHosts.servicesError': 'Não foi possível carregar os serviços.',
    'linuxHosts.noServices': 'Sem serviços registados.',
    'linuxHosts.protocolPort': 'Protocolo / porta',
    'linuxHosts.version': 'Versão',
    'linuxHosts.observedStatus': 'Estado observado',
    'linuxHosts.observed.ONLINE': 'Online',
    'linuxHosts.observed.OFFLINE': 'Offline',
    'linuxHosts.lastSeen': 'Última observação',
    'linuxHosts.history': 'Histórico do agente',
    'linuxHosts.noHistory': 'Sem eventos do agente.',
    'linuxHosts.audit': 'Ver na auditoria',
    'linuxHosts.enroll': 'Inscrever agente',
    'linuxHosts.enrollHost': 'Inscrever agente de {name}',
    'linuxHosts.enrolling': 'A inscrever…',
    'linuxHosts.enrolled': 'Agente inscrito',
    'linuxHosts.enrollError': 'Não foi possível inscrever o agente.',
    'linuxHosts.revoke': 'Revogar agente',
    'linuxHosts.revokeHost': 'Revogar agente de {name}',
    'linuxHosts.revokeConfirm': 'Revogar o agente de {name}? O token atual deixa de aceitar heartbeats.',
    'linuxHosts.revoked': 'Agente revogado',
    'linuxHosts.revokeError': 'Não foi possível revogar o agente.',
    'linuxHosts.host': 'Host',
    'linuxHosts.selectHost': 'Seleciona um host com equipamento associado',
    'linuxHosts.tokenIssued': 'Token já emitido.',
    'linuxHosts.tokenOnce': 'Copia o token antes de fechar. Só é apresentado uma vez.',
    'linuxHosts.token': 'Token do agente',
    'linuxHosts.copy': 'Copiar token',
    'linuxHosts.copied': 'Token copiado.',
    'linuxHosts.copyError': 'Não foi possível copiar o token. Seleciona-o e copia-o manualmente.',
    'linuxHosts.installHint': 'No Linux, obtém o ficheiro linux_heartbeat_agent.py do projeto. Guarda o token em ~/.management-agent-token com permissão 600 na conta dedicada. Instala e executa com o comando abaixo, usando o endereço HTTPS da aplicação.',
    'linuxHosts.close': 'Fechar',
    'settings.finish': 'Concluir',
    'profile.menu': 'Definições do perfil', 'profile.title': 'Perfil', 'profile.kicker': 'CONTA E ACESSOS', 'profile.tabs.profile': 'Perfil', 'profile.tabs.roles': 'Solicitar roles', 'profile.username': 'Utilizador', 'profile.roles': 'Roles atuais', 'profile.rolesTitle': 'Solicitar acesso adicional', 'profile.rolesDescription': 'Seleciona as roles que precisas. Um administrador irá analisar o pedido.', 'profile.submit': 'Enviar pedido', 'profile.pending': 'Pedido pendente', 'profile.processing': 'Pedido em processamento', 'profile.alreadyAssigned': 'Já atribuída', 'profile.requestSent': 'Pedido enviado', 'profile.loadError': 'Não foi possível carregar o perfil.', 'profile.submitError': 'Não foi possível enviar o pedido.', 'profile.history': 'Histórico de pedidos', 'profile.noHistory': 'Ainda não existem pedidos.', 'profile.status.PENDING': 'Pendente', 'profile.status.PROCESSING': 'Em processamento', 'profile.status.APPROVED': 'Aprovado', 'profile.status.REJECTED': 'Rejeitado', 'settings.requested': 'Solicitou', 'settings.requestProcessing': 'Pedido em processamento', 'settings.accept': 'Aceitar', 'settings.reject': 'Rejeitar', 'settings.requestApproved': 'Pedido aprovado', 'settings.requestRejected': 'Pedido rejeitado', 'settings.requestDecisionError': 'Não foi possível decidir o pedido.',
    'common.save': 'Guardar alterações', 'common.cancel': 'Cancelar', 'common.edit': 'Editar', 'common.delete': 'Eliminar', 'common.refresh': 'Atualizar', 'common.loading': 'A carregar…', 'common.previous': 'Anterior', 'common.next': 'Seguinte',
    'profile.tabs.notifications': 'Notificações',
    'notifications.title': 'Notificações',
    'notifications.description': 'Consulta as notificações da tua conta.',
    'notifications.markAll': 'Marcar todas como lidas',
    'notifications.status': 'Estado',
    'notifications.all': 'Todas',
    'notifications.unreadOnly': 'Por ler',
    'notifications.type': 'Tipo',
    'notifications.allTypes': 'Todos os tipos',
    'notifications.type.ROLE_REQUEST': 'Pedidos de acesso',
    'notifications.type.LIFECYCLE_DATE': 'Datas de ciclo de vida',
    'notifications.type.CRITICAL_ASSET_ATTESTATION': 'Atestação de ativos críticos',
    'notifications.readError': 'Não foi possível atualizar o estado da notificação.',
    'notifications.close': 'Fechar notificação',
    'notifications.openSource': 'Abrir registo de origem',
    'notifications.loadError': 'Não foi possível carregar as notificações.',
    'notifications.noUnread': 'Não há notificações por ler para estes filtros.',
    'notifications.empty': 'Não há notificações para estes filtros.',
    'notifications.read': 'Lida',
    'notifications.unread': 'Por ler',
    'notifications.markUnread': 'Marcar como por ler',
    'notifications.markRead': 'Marcar como lida',
    'notifications.loadMore': 'Carregar mais',
    'notifications.preferences': 'Preferências de notificações',
    'notifications.preferenceHint': 'Seleciona os tipos de notificação que queres receber. A escolha aplica-se a futuras notificações.',
    'notifications.preferenceError': 'Não foi possível guardar a preferência.',
    'notifications.preferencesLoadError': 'Não foi possível carregar as preferências.',
    'notifications.teams': 'Também no Microsoft Teams',
    'notifications.teamsHint': 'Podes receber uma cópia de cada tipo no canal Microsoft Teams configurado pela administração. A mensagem indica o destinatário e é visível para os membros desse canal.',
    'notifications.teamsUnavailable': 'O envio para Microsoft Teams ainda não está ativo. Um ADMIN pode ativá-lo em Definições → Notificações.',
    'notifications.email': 'Também por email',
    'notifications.emailHint': 'Podes receber uma cópia de cada tipo no email da tua conta. Só tu a recebes.',
    'notifications.emailUnavailable': 'O envio por email ainda não está ativo. Um ADMIN pode ativá-lo em Definições → Notificações.',
    'notifications.emailMissing': 'A tua conta não tem um email definido, por isso não é possível receber notificações por email.',
    'reports.subscriptions': 'Relatórios agendados',
    'reports.subscriptionsHint': 'Relatórios que um ADMIN te enviou. Cada um inclui apenas os Sites a que tens acesso. Desmarca para deixar de receber por email; podes descarregar o CSV atual quando quiseres.',
    'reports.paused': 'envio agendado em pausa',
    'reports.download': 'CSV',
    'reports.downloadLabel': 'Descarregar CSV de {name}',
    'reports.loadError': 'Não foi possível carregar os relatórios agendados.',
    'reports.toggleError': 'Não foi possível guardar a subscrição.',
    'reports.downloadError': 'Não foi possível descarregar o CSV.',
    'reports.unsubscribe.title': 'Cancelar subscrição',
    'reports.unsubscribe.loading': 'A verificar a ligação…',
    'reports.unsubscribe.question': 'Deixar de receber o relatório “{name}” por email?',
    'reports.unsubscribe.confirm': 'Cancelar subscrição',
    'reports.unsubscribe.working': 'A cancelar…',
    'reports.unsubscribe.done': 'Já não vais receber o relatório “{name}”. Podes voltar a subscrever em Perfil → Notificações.',
    'reports.unsubscribe.invalid': 'Esta ligação de cancelamento é inválida ou já não está disponível.',
    'reports.unsubscribe.error': 'Não foi possível cancelar a subscrição. Tenta novamente.',
    'reports.unsubscribe.back': 'Abrir a aplicação',
    'ipam.action.create': 'criação', 'ipam.action.update': 'edição', 'ipam.action.delete': 'remoção', 'ipam.action.discover': 'descoberta', 'ipam.action.import': 'importação', 'ipam.recent.ip': 'Endereço IP', 'ipam.scope.limited': 'Âmbito ativo: Site {site}. As permissões atuais não permitem {actions}.',
    'nav.group.overview': 'Visão geral', 'nav.group.operations': 'Operação', 'nav.group.governance': 'Governança', 'nav.dashboard': 'Dashboard', 'nav.infrastructure': 'Infraestrutura', 'nav.topology': 'Topologia', 'nav.quality': 'Qualidade', 'nav.criticalAssets': 'Ativos críticos', 'nav.changes': 'Alterações', 'nav.portal': 'Portal interno', 'nav.ipam': 'IPAM', 'nav.discovery': 'Descoberta', 'nav.snmp': 'SNMP', 'nav.netapp': 'NetApp', 'nav.audit': 'Auditoria', 'nav.settings': 'Definições', 'nav.help': 'Ajuda e suporte', 'dashboard.editLayout': 'Editar layout', 'dashboard.finishEditing': 'Concluir edição', 'dashboard.siteOperations': 'Estado operacional do Site', 'dashboard.runningProcesses': 'Processos em execução', 'dashboard.discoveryReview': 'Discovery a rever ou falhado', 'dashboard.snmpDrifts': 'Divergências SNMP', 'dashboard.servicesUnavailable': 'Estado dos serviços indisponível', 'dashboard.servicesLoadError': 'Não foi possível carregar o estado.', 'dashboard.servicesLoading': 'A carregar estado dos serviços…', 'dashboard.inventoryLoadError': 'Não foi possível carregar o inventário. Tenta atualizar.', 'dashboard.inventoryLoading': 'A carregar dados do inventário…', 'dashboard.kpis': 'Indicadores do Site', 'dashboard.assets': 'Ativos', 'dashboard.assetsDetail': 'equipamentos no Site', 'dashboard.severity.critical': 'Crítico', 'dashboard.severity.high': 'Alto', 'dashboard.severity.warning': 'Aviso', 'dashboard.severity.info': 'Info', 'dashboard.severityDetail': '{alerts} alertas · {quality} qualidade', 'dashboard.error': 'Erro', 'dashboard.servicesList': 'Lista de serviços', 'dashboard.activityList': 'Lista de atividade recente', 'dashboard.inventoryList': 'Distribuição do inventário', 'dashboard.kpiWidget': 'Indicador no topo', 'dashboard.fitOverflowWarning': 'Os widgets visíveis não cabem num único ecrã: o dashboard volta a ter scroll. Esconde widgets ou usa a largura Metade.', 'dashboard.workspacesError': 'Não foi possível carregar os workspaces do dashboard. Tenta atualizar.', 'dashboard.noWorkspace': 'Sem workspace disponível para este Site.', 'dashboard.retry': 'Tentar novamente', 'dashboard.alertsTitle': 'Alertas ativos', 'dashboard.qualityTitle': 'Qualidade dos dados', 'dashboard.loading': 'A carregar…',
    'shell.activeSite': 'Site ativo', 'shell.allSites': 'Todos os Sites', 'shell.globalView': 'Visão global da organização', 'shell.createSite': 'Criar novo Site', 'shell.addLocation': 'Adicionar uma localização operacional', 'shell.nextSteps': 'Próximos passos', 'shell.continueIpam': 'Continue a configurar o inventário IPAM.',
    'shell.operational': 'Ambiente operacional', 'shell.degraded': 'Ambiente degradado', 'shell.unavailable': 'Ambiente indisponível', 'shell.setup': 'Configuração inicial', 'shell.setupComplete': 'Concluída', 'shell.setupPending': 'Pendente', 'shell.updated': 'Atualizado',
    'shell.copyright': '© 2026 Management App', 'shell.copyrightShort': '© 2026',
    'rack.pdu.source.SUPPLIER': 'Rede', 'rack.pdu.source.UPS': 'UPS', 'rack.pdu.badge': '{used}/{total} em uso · {watts} est.', 'rack.pdu.open': '{name} ({source}): {used} de {total} tomadas em uso, {watts} estimado. Abrir detalhes', 'rack.pdu.outlets': 'Tomadas', 'rack.pdu.load': 'Consumo', 'rack.pdu.estimated': 'estimado', 'rack.pdu.budget': 'Limite', 'rack.pdu.sourceLabel': 'Fonte', 'rack.pdu.noBudget': 'sem limite definido', 'rack.pdu.failover': 'Se a outra fonte falhar: {watts}', 'rack.pdu.devices': 'Equipamentos ligados', 'rack.pdu.empty': 'Nenhum equipamento ligado a esta PDU.', 'rack.pdu.plugs.one': '{count} tomada', 'rack.pdu.plugs.other': '{count} tomadas', 'rack.pdu.disconnect': 'Desligar', 'rack.pdu.disconnectLabel': 'Desligar {device} de {pdu}', 'rack.pdu.disconnectConfirm': 'Desligar {device} de {pdu}? Liberta {count} tomada(s).', 'rack.pdu.cancel': 'Cancelar', 'rack.pdu.disconnecting': 'A desligar…', 'rack.pdu.disconnectFailed': 'Não foi possível desligar o equipamento.', 'rack.pdu.readOnly': 'Só leitura', 'rack.pdu.close': 'Fechar', 'rack.pdu.dualFed': '2 fontes', 'rack.power.total': '{total} estimado ({parts})', 'rack.power.part': '{source} {watts}', 'power.mode': 'Alimentação', 'power.mode.supplier': 'Só rede elétrica', 'power.mode.supplierUps': 'Rede + UPS', 'power.pduSettings': 'Definições da {name}', 'power.pduName': 'Nome', 'power.pduOutlets': 'Tomadas', 'power.pduBudget': 'Potência máxima (W)', 'power.pduBudgetHelp': 'Por omissão {watts} W. Os valores são estimativas e nunca bloqueiam a gravação.', 'power.upsBlocked': 'Não é possível remover a UPS: estes equipamentos ainda estão ligados à PDU UPS.', 'power.disconnectAllUps': 'Desligar todos da UPS', 'power.disconnectingAll': 'A desligar…', 'power.conflict': 'A alteração deixaria equipamentos sem tomada. Desliga-os ou muda-os para tomadas livres primeiro.', 'power.plugs': 'Fontes / fichas', 'power.plugsHelp': '{min} a {max}. 0 = sem alimentação (ex.: patch panel).', 'power.watts': 'Consumo estimado (W)', 'power.source.manual': 'manual', 'power.source.model': 'modelo', 'power.source.default': 'padrão', 'power.resetWatts': 'Usar valor do {source}', 'power.step.title': 'Ligações elétricas · {device}', 'power.step.intro': 'Escolhe a PDU de cada ficha. A tomada livre seguinte é atribuída automaticamente.', 'power.step.plug': 'Ficha {index}', 'power.step.pdu': 'PDU', 'power.step.outlet': 'Tomada', 'power.step.unplugged': 'Não ligado', 'power.step.auto': 'Tomada {outlet} (auto)', 'power.step.free': '{count} livres', 'power.step.full': 'Sem tomadas livres em {pdu}: a ficha fica “Não ligado”.', 'power.step.unpluggedWarning': '{count} ficha(s) sem ligação. Podes guardar na mesma.', 'power.step.noRedundancy': 'Este bastidor não tem UPS: o equipamento não tem alimentação redundante.', 'power.step.noPower': 'Sem alimentação: este equipamento não tem fichas.', 'power.step.save': 'Guardar ligações', 'power.step.skip': 'Agora não', 'power.step.saving': 'A guardar…', 'power.step.moved': 'O equipamento mudou de bastidor: as ligações anteriores foram removidas.', 'power.step.open': 'Ligações elétricas', 'power.estimateNote': 'Valores estimados', 'power.error.open': 'Não foi possível abrir as ligações elétricas.', 'power.error.save': 'Não foi possível guardar as ligações elétricas.', 'power.error.upsFirst': 'Desliga os equipamentos da UPS antes de mudar para “Só rede elétrica”.', 'power.error.disconnectAll': 'Não foi possível desligar os equipamentos da UPS.',
    'rack.view': 'Vista', 'rack.view.front': 'Frente', 'rack.view.rear': 'Traseira', 'rack.view.both': 'Ambas', 'rack.zoom': 'Zoom', 'rack.zoomPanel': 'Zoom do bastidor', 'rack.zoomLevel': 'Nível de zoom', 'rack.zoomFit': 'Ajustar ao ecrã', 'rack.back': 'Voltar aos bastidores', 'rack.edit': 'Editar bastidor', 'rack.delete': 'Eliminar bastidor', 'rack.deleting': 'A eliminar…', 'device.noFrontImage': 'Sem imagem frontal', 'device.noRearImage': 'Sem imagem traseira',
    'audit.userFilterPlaceholder': 'Nome ou username',
    'settings.title': 'Definições', 'settings.kicker': 'CONFIGURAÇÃO DA PLATAFORMA', 'settings.organization': 'Organização', 'settings.sites': 'Sites', 'settings.users': 'Utilizadores e roles', 'settings.discovery': 'Discovery', 'settings.snmp': 'SNMP', 'settings.audit': 'Auditoria', 'settings.searchPlaceholder': 'Pesquisar uma definição…', 'settings.searchResults': 'Definições encontradas', 'settings.noResults': 'Sem definições correspondentes.',
    'settings.orgTitle': 'Dados institucionais', 'settings.name': 'Nome', 'settings.code': 'Código', 'settings.timezone': 'Fuso horário', 'settings.language': 'Linguagem da aplicação', 'settings.pt': 'Português (Portugal)', 'settings.en': 'English (United States)',
    'settings.sitesTitle': 'Localizações operacionais', 'settings.newSite': 'Novo Site', 'settings.noSites': 'Ainda não existem Sites.', 'settings.location': 'Localização', 'settings.inventory': 'Inventário', 'settings.emptyOnly': 'Só é possível eliminar Sites sem inventário.', 'settings.confirmCode': 'Escreve o código do Site para confirmar', 'settings.buildings': 'edifícios', 'settings.equipment': 'equipamentos', 'settings.address': 'Morada', 'settings.city': 'Cidade', 'settings.region': 'Região', 'settings.country': 'País',
    'settings.usersTitle': 'Acessos à aplicação', 'settings.searchUsers': 'Pesquisar utilizador ou email…', 'settings.directRoles': 'Roles diretas', 'settings.inheritedRoles': 'Roles herdadas', 'settings.noUsers': 'Não foram encontrados utilizadores.', 'settings.kcUnavailable': 'A administração do Keycloak não está configurada nesta instalação.', 'settings.userCount': 'utilizadores', 'role.ADMIN': 'Administrador', 'role.NETWORK_OPERATOR': 'Operador de rede', 'role.SYSTEMS_OPERATOR': 'Operador de sistemas', 'role.STORAGE_OPERATOR': 'Operador de storage', 'role.AUDITOR': 'Auditor', 'role.READ_ONLY': 'Apenas leitura',
    'settings.discoveryTitle': 'Defaults de novas descobertas', 'settings.methods': 'Métodos', 'settings.ports': 'Portas TCP', 'settings.reverseDns': 'Resolver nomes por reverse DNS', 'settings.interval': 'Intervalo predefinido', 'settings.newOnly': 'Aplica-se apenas a novas execuções e schedules.', 'settings.allowedCidrs': 'Redes autorizadas para Discovery', 'settings.allowedCidrsHint': 'Um CIDR por linha. Redes públicas internas exigem aprovação explícita de ADMIN.',
    'settings.snmpListeners': 'Interfaces de escuta SNMP', 'settings.snmpListenersHint': 'Escolhe os IPs do host onde os equipamentos enviam traps e informs.', 'settings.snmpListenMode': 'Modo de escuta', 'settings.snmpListenAll': 'Todas as interfaces', 'settings.snmpListenSelected': 'Interfaces selecionadas', 'settings.snmpListenSelectedHint': 'Pode ser selecionado mais do que um endereço.', 'settings.snmpAvailableInterfaces': 'Interfaces disponíveis no host', 'settings.snmpInternal': 'interna', 'settings.snmpNoInterfaces': 'Sem interfaces do host disponíveis', 'settings.snmpNoInterfacesHint': 'Inicia npm run snmp:host-agent no host e atualiza esta página.', 'settings.snmpApplyHint': 'O agente do host reaplica a configuração em até 30 segundos.', 'settings.snmpSaveError': 'Não foi possível guardar as interfaces de escuta SNMP.',
    'settings.auditTitle': 'Retenção de eventos', 'settings.retention': 'Dias de retenção', 'settings.totalEvents': 'Eventos guardados', 'settings.oldestEvent': 'Evento mais antigo', 'settings.lastCleanup': 'Última limpeza', 'settings.nextCleanup': 'Próxima limpeza',
    'setup.language': 'Linguagem da aplicação', 'setup.welcome': 'Vamos preparar o teu espaço de trabalho.', 'setup.organization': 'Organização', 'setup.firstSite': 'Primeiro site', 'setup.finish': 'Concluir', 'setup.welcomeStep': 'Boas-vindas', 'setup.asideDescription': 'Antes de gerir infraestrutura, precisamos de saber a que organização e localizações pertence este inventário.', 'setup.firstRun': 'PRIMEIRA EXECUÇÃO', 'setup.welcomeTitle': 'Bem-vindo ao COCiber Management.', 'setup.welcomeDescription': 'Este assistente cria a configuração mínima da aplicação sem inventar equipamentos, redes ou dados. Poderás completar o inventário mais tarde.', 'setup.start': 'Começar', 'setup.step1': 'PASSO 1 DE 3', 'setup.orgQuestion': 'Como se chama a organização?', 'setup.orgDescription': 'Este nome será usado no cabeçalho e no contexto operacional da aplicação.', 'setup.orgName': 'Nome da organização', 'setup.orgNameExample': 'Ex.: Centro de Operações de Cibersegurança', 'setup.shortCode': 'Código curto', 'setup.shortCodeExample': 'Ex.: COCIBER', 'setup.timezone': 'Fuso horário', 'setup.back': 'Voltar', 'setup.continue': 'Continuar', 'setup.saving': 'A guardar...', 'setup.step2': 'PASSO 2 DE 3', 'setup.siteTitle': 'Regista o primeiro site.', 'setup.siteDescription': 'Um site representa uma localização operacional. O edifício, sala e bastidor são opcionais e podem ser preenchidos agora ou mais tarde.', 'setup.siteName': 'Nome do site', 'setup.siteNameExample': 'Ex.: Sede Lisboa', 'setup.siteCode': 'Código do site', 'setup.siteCodeExample': 'Ex.: LIS-01', 'setup.address': 'Morada', 'setup.addressExample': 'Rua, número', 'setup.city': 'Cidade', 'setup.region': 'Região', 'setup.country': 'País', 'setup.optionalHierarchy': 'Hierarquia física opcional', 'setup.building': 'Edifício', 'setup.buildingExample': 'Ex.: Edifício principal', 'setup.room': 'Sala', 'setup.roomExample': 'Ex.: Sala técnica', 'setup.rack': 'Primeiro bastidor', 'setup.rackExample': 'Ex.: RACK-01', 'setup.creating': 'A criar...', 'setup.createSite': 'Criar site', 'setup.step3': 'PASSO 3 DE 3', 'setup.ready': 'A base está pronta.', 'setup.readyDescription': '{organization} tem agora o site {site} ({code}). A partir daqui podes começar a registar VLANs, subnets, equipamentos e links.', 'setup.finishing': 'A concluir...', 'setup.enter': 'Entrar na aplicação', 'setup.preparing': 'A preparar a configuração inicial...', 'setup.adminTitle': 'É necessária intervenção de um administrador.', 'setup.adminDescription': 'A primeira configuração desta instalação só pode ser concluída por um utilizador com a role ADMIN.',
  },
  'en-US': {
    'capacity.title': 'Capacity',
    'capacity.resource': 'Resource',
    'capacity.current': 'Utilisation',
    'capacity.trend': 'Trend / 30 days',
    'capacity.estimateAt': 'Estimate at {threshold}',
    'capacity.estimate': 'Estimate',
    'capacity.refresh': 'Refresh',
    'capacity.filter': 'Resource type',
    'capacity.all': 'All types',
    'capacity.thresholds': 'Warning at {warning} · Critical at {critical}',
    'capacity.failed': 'Could not load Site capacity.',
    'capacity.empty': 'No capacity resources match this filter.',
    'capacity.method': 'Trend over the last {days} days with comparable capacity, in percentage points (pp). Estimates extend up to 12 months. Power uses estimated draw.',
    'capacity.points': '{amount} pp',
    'capacity.observed': 'Measured on {date}',
    'capacity.kind.SUBNET': 'Subnet',
    'capacity.kind.NETAPP_VOLUME': 'NetApp volume',
    'capacity.kind.NETAPP_AGGREGATE': 'NetApp aggregate',
    'capacity.kind.RACK_SPACE': 'Rack space',
    'capacity.kind.RACK_POWER': 'Rack power',
    'capacity.kind.PDU_POWER': 'PDU power',
    'capacity.status.INSUFFICIENT': 'Insufficient data',
    'capacity.status.ALREADY_AT_THRESHOLD': 'At or above threshold',
    'capacity.status.NO_GROWTH': 'No growth',
    'capacity.status.BEYOND_HORIZON': 'Beyond 12 months',
    'capacity.level.ok': 'Normal',
    'capacity.level.warning': 'Warning',
    'capacity.level.critical': 'Critical',
    'linuxHosts.scrollColumns': 'Scroll to see more columns.',
    'linuxHosts.firstColumns': 'Show first columns',
    'linuxHosts.lastColumns': 'Show last columns',
    'linuxHosts.title': 'Servers',
    'linuxHosts.description': 'View hosts, services and Linux agent status.',
    'linuxHosts.site': 'Site',
    'linuxHosts.allSites': 'All sites',
    'linuxHosts.state': 'Agent status',
    'linuxHosts.allStates': 'All statuses',
    'linuxHosts.state.ONLINE': 'Online',
    'linuxHosts.state.STALE': 'Late',
    'linuxHosts.state.NONE': 'No agent',
    'linuxHosts.state.REVOKED': 'Revoked',
    'linuxHosts.name': 'Name',
    'linuxHosts.hostname': 'Hostname',
    'linuxHosts.os': 'Operating system',
    'linuxHosts.device': 'Linked device',
    'linuxHosts.ips': 'IP addresses',
    'linuxHosts.heartbeat': 'Last heartbeat',
    'linuxHosts.agentVersion': 'Agent version',
    'linuxHosts.actions': 'Actions',
    'linuxHosts.threshold': 'An agent is late after {minutes} min without a heartbeat.',
    'linuxHosts.empty': 'No servers match the filters.',
    'linuxHosts.loadError': 'Could not load servers.',
    'linuxHosts.services': 'Services',
    'linuxHosts.servicesError': 'Could not load services.',
    'linuxHosts.noServices': 'No services recorded.',
    'linuxHosts.protocolPort': 'Protocol / port',
    'linuxHosts.version': 'Version',
    'linuxHosts.observedStatus': 'Observed status',
    'linuxHosts.observed.ONLINE': 'Online',
    'linuxHosts.observed.OFFLINE': 'Offline',
    'linuxHosts.lastSeen': 'Last seen',
    'linuxHosts.history': 'Agent history',
    'linuxHosts.noHistory': 'No agent events.',
    'linuxHosts.audit': 'View in audit log',
    'linuxHosts.enroll': 'Enroll agent',
    'linuxHosts.enrollHost': 'Enroll agent for {name}',
    'linuxHosts.enrolling': 'Enrolling…',
    'linuxHosts.enrolled': 'Agent enrolled',
    'linuxHosts.enrollError': 'Could not enroll the agent.',
    'linuxHosts.revoke': 'Revoke agent',
    'linuxHosts.revokeHost': 'Revoke agent for {name}',
    'linuxHosts.revokeConfirm': 'Revoke the agent for {name}? The current token will stop accepting heartbeats.',
    'linuxHosts.revoked': 'Agent revoked',
    'linuxHosts.revokeError': 'Could not revoke the agent.',
    'linuxHosts.host': 'Host',
    'linuxHosts.selectHost': 'Select a host with a linked device',
    'linuxHosts.tokenIssued': 'Token already issued.',
    'linuxHosts.tokenOnce': 'Copy the token before closing. It is shown only once.',
    'linuxHosts.token': 'Agent token',
    'linuxHosts.copy': 'Copy token',
    'linuxHosts.copied': 'Token copied.',
    'linuxHosts.copyError': 'Could not copy the token. Select it and copy it manually.',
    'linuxHosts.installHint': 'On Linux, get linux_heartbeat_agent.py from the project. Save the token in ~/.management-agent-token with mode 600 under the dedicated account. Install and run with the command below using the application\'s HTTPS address.',
    'linuxHosts.close': 'Close',
    'settings.finish': 'Finish',
    'profile.menu': 'Profile settings', 'profile.title': 'Profile', 'profile.kicker': 'ACCOUNT AND ACCESS', 'profile.tabs.profile': 'Profile', 'profile.tabs.roles': 'Request roles', 'profile.username': 'User', 'profile.roles': 'Current roles', 'profile.rolesTitle': 'Request additional access', 'profile.rolesDescription': 'Select the roles you need. An administrator will review your request.', 'profile.submit': 'Send request', 'profile.pending': 'Pending request', 'profile.processing': 'Request processing', 'profile.alreadyAssigned': 'Already assigned', 'profile.requestSent': 'Request sent', 'profile.loadError': 'Could not load your profile.', 'profile.submitError': 'Could not submit the request.', 'profile.history': 'Request history', 'profile.noHistory': 'No requests yet.', 'profile.status.PENDING': 'Pending', 'profile.status.PROCESSING': 'Processing', 'profile.status.APPROVED': 'Approved', 'profile.status.REJECTED': 'Rejected', 'settings.requested': 'Requested', 'settings.requestProcessing': 'Request processing', 'settings.accept': 'Accept', 'settings.reject': 'Reject', 'settings.requestApproved': 'Request approved', 'settings.requestRejected': 'Request rejected', 'settings.requestDecisionError': 'Could not decide the request.',
    'common.save': 'Save changes', 'common.cancel': 'Cancel', 'common.edit': 'Edit', 'common.delete': 'Delete', 'common.refresh': 'Refresh', 'common.loading': 'Loading…', 'common.previous': 'Previous', 'common.next': 'Next',
    'profile.tabs.notifications': 'Notifications',
    'notifications.title': 'Notifications',
    'notifications.description': 'View notifications for your account.',
    'notifications.markAll': 'Mark all as read',
    'notifications.status': 'Status',
    'notifications.all': 'All',
    'notifications.unreadOnly': 'Unread',
    'notifications.type': 'Type',
    'notifications.allTypes': 'All types',
    'notifications.type.ROLE_REQUEST': 'Access requests',
    'notifications.type.LIFECYCLE_DATE': 'Lifecycle dates',
    'notifications.type.CRITICAL_ASSET_ATTESTATION': 'Critical asset attestation',
    'notifications.readError': 'Could not update the notification status.',
    'notifications.close': 'Close notification',
    'notifications.openSource': 'Open source record',
    'notifications.loadError': 'Could not load notifications.',
    'notifications.noUnread': 'No unread notifications match these filters.',
    'notifications.empty': 'No notifications match these filters.',
    'notifications.read': 'Read',
    'notifications.unread': 'Unread',
    'notifications.markUnread': 'Mark as unread',
    'notifications.markRead': 'Mark as read',
    'notifications.loadMore': 'Load more',
    'notifications.preferences': 'Notification preferences',
    'notifications.preferenceHint': 'Select the notification types to receive. Your choices apply to future notifications.',
    'notifications.preferenceError': 'Could not save the preference.',
    'notifications.preferencesLoadError': 'Could not load preferences.',
    'notifications.teams': 'Also in Microsoft Teams',
    'notifications.teamsHint': 'You can get a copy of each type in the Microsoft Teams channel set up by the administrators. The message names the recipient and is visible to that channel\'s members.',
    'notifications.teamsUnavailable': 'Microsoft Teams delivery is not active yet. An ADMIN can turn it on in Settings → Notifications.',
    'notifications.email': 'Also by email',
    'notifications.emailHint': 'You can get a copy of each type at your account\'s email address. Only you receive it.',
    'notifications.emailUnavailable': 'Email delivery is not active yet. An ADMIN can turn it on in Settings → Notifications.',
    'notifications.emailMissing': 'Your account has no email address, so email notifications are not possible.',
    'reports.subscriptions': 'Scheduled reports',
    'reports.subscriptionsHint': 'Reports an ADMIN sends you. Each one covers only the Sites you can access. Clear the box to stop getting it by email; you can download the current CSV at any time.',
    'reports.paused': 'scheduled sending paused',
    'reports.download': 'CSV',
    'reports.downloadLabel': 'Download CSV of {name}',
    'reports.loadError': 'Could not load scheduled reports.',
    'reports.toggleError': 'Could not save the subscription.',
    'reports.downloadError': 'Could not download the CSV.',
    'reports.unsubscribe.title': 'Unsubscribe',
    'reports.unsubscribe.loading': 'Checking the link…',
    'reports.unsubscribe.question': 'Stop getting the “{name}” report by email?',
    'reports.unsubscribe.confirm': 'Unsubscribe',
    'reports.unsubscribe.working': 'Unsubscribing…',
    'reports.unsubscribe.done': 'You will no longer get the “{name}” report. You can subscribe again in Profile → Notifications.',
    'reports.unsubscribe.invalid': 'This unsubscribe link is invalid or no longer available.',
    'reports.unsubscribe.error': 'Could not unsubscribe. Please try again.',
    'reports.unsubscribe.back': 'Open the app',
    'ipam.action.create': 'creation', 'ipam.action.update': 'editing', 'ipam.action.delete': 'deletion', 'ipam.action.discover': 'discovery', 'ipam.action.import': 'import', 'ipam.recent.ip': 'IP address', 'ipam.scope.limited': 'Active scope: Site {site}. Current permissions do not allow {actions}.',
    'nav.group.overview': 'Overview', 'nav.group.operations': 'Operations', 'nav.group.governance': 'Governance', 'nav.dashboard': 'Dashboard', 'nav.infrastructure': 'Infrastructure', 'nav.topology': 'Topology', 'nav.quality': 'Quality', 'nav.criticalAssets': 'Critical assets', 'nav.changes': 'Changes', 'nav.portal': 'Internal portal', 'nav.ipam': 'IPAM', 'nav.discovery': 'Discovery', 'nav.snmp': 'SNMP', 'nav.netapp': 'NetApp', 'nav.audit': 'Audit', 'nav.settings': 'Settings', 'nav.help': 'Help and support', 'dashboard.editLayout': 'Edit layout', 'dashboard.finishEditing': 'Finish editing', 'dashboard.siteOperations': 'Site operational status', 'dashboard.runningProcesses': 'Running processes', 'dashboard.discoveryReview': 'Discovery pending or failed', 'dashboard.snmpDrifts': 'SNMP discrepancies', 'dashboard.servicesUnavailable': 'Service status unavailable', 'dashboard.servicesLoadError': 'Could not load service status.', 'dashboard.servicesLoading': 'Loading service status…', 'dashboard.inventoryLoadError': 'Could not load inventory. Try refreshing.', 'dashboard.inventoryLoading': 'Loading inventory data…', 'dashboard.kpis': 'Site indicators', 'dashboard.assets': 'Assets', 'dashboard.assetsDetail': 'devices in this Site', 'dashboard.severity.critical': 'Critical', 'dashboard.severity.high': 'High', 'dashboard.severity.warning': 'Warning', 'dashboard.severity.info': 'Info', 'dashboard.severityDetail': '{alerts} alerts · {quality} quality', 'dashboard.error': 'Error', 'dashboard.servicesList': 'Service list', 'dashboard.activityList': 'Recent activity list', 'dashboard.inventoryList': 'Inventory distribution', 'dashboard.kpiWidget': 'Indicator at the top', 'dashboard.fitOverflowWarning': 'The visible widgets do not fit on one screen, so the dashboard scrolls again. Hide widgets or use Half width.', 'dashboard.workspacesError': 'Could not load the dashboard workspaces. Try refreshing.', 'dashboard.noWorkspace': 'No workspace available for this Site.', 'dashboard.retry': 'Try again', 'dashboard.alertsTitle': 'Active alerts', 'dashboard.qualityTitle': 'Data quality', 'dashboard.loading': 'Loading…',

    'shell.activeSite': 'Active site', 'shell.allSites': 'All Sites', 'shell.globalView': 'Organization-wide view', 'shell.createSite': 'Create new Site', 'shell.addLocation': 'Add an operational location', 'shell.nextSteps': 'Next steps', 'shell.continueIpam': 'Continue configuring the IPAM inventory.',
    'shell.operational': 'Operational environment', 'shell.degraded': 'Degraded environment', 'shell.unavailable': 'Environment unavailable', 'shell.setup': 'Initial setup', 'shell.setupComplete': 'Completed', 'shell.setupPending': 'Pending', 'shell.updated': 'Updated',
    'shell.copyright': '© 2026 Management App', 'shell.copyrightShort': '© 2026',
    'rack.pdu.source.SUPPLIER': 'Mains', 'rack.pdu.source.UPS': 'UPS', 'rack.pdu.badge': '{used}/{total} used · {watts} est.', 'rack.pdu.open': '{name} ({source}): {used} of {total} outlets used, {watts} estimated. Open details', 'rack.pdu.outlets': 'Outlets', 'rack.pdu.load': 'Load', 'rack.pdu.estimated': 'estimated', 'rack.pdu.budget': 'Budget', 'rack.pdu.sourceLabel': 'Feed', 'rack.pdu.noBudget': 'no budget set', 'rack.pdu.failover': 'If the other feed fails: {watts}', 'rack.pdu.devices': 'Connected devices', 'rack.pdu.empty': 'No device is plugged into this PDU.', 'rack.pdu.plugs.one': '{count} outlet', 'rack.pdu.plugs.other': '{count} outlets', 'rack.pdu.disconnect': 'Disconnect', 'rack.pdu.disconnectLabel': 'Disconnect {device} from {pdu}', 'rack.pdu.disconnectConfirm': 'Disconnect {device} from {pdu}? Frees {count} outlet(s).', 'rack.pdu.cancel': 'Cancel', 'rack.pdu.disconnecting': 'Disconnecting…', 'rack.pdu.disconnectFailed': 'Could not disconnect the device.', 'rack.pdu.readOnly': 'Read only', 'rack.pdu.close': 'Close', 'rack.pdu.dualFed': '2 feeds', 'rack.power.total': '{total} estimated ({parts})', 'rack.power.part': '{source} {watts}', 'power.mode': 'Power', 'power.mode.supplier': 'Mains only', 'power.mode.supplierUps': 'Mains + UPS', 'power.pduSettings': '{name} settings', 'power.pduName': 'Name', 'power.pduOutlets': 'Outlets', 'power.pduBudget': 'Power budget (W)', 'power.pduBudgetHelp': 'Defaults to {watts} W. Values are estimates and never block saving.', 'power.upsBlocked': 'The UPS cannot be removed: these devices are still plugged into the UPS PDU.', 'power.disconnectAllUps': 'Disconnect all from UPS', 'power.disconnectingAll': 'Disconnecting…', 'power.conflict': 'This change would leave devices without an outlet. Disconnect them or move them to free outlets first.', 'power.plugs': 'Power plugs', 'power.plugsHelp': '{min} to {max}. 0 = no power (e.g. patch panel).', 'power.watts': 'Estimated load (W)', 'power.source.manual': 'manual', 'power.source.model': 'model', 'power.source.default': 'default', 'power.resetWatts': 'Use {source} value', 'power.step.title': 'Power connections · {device}', 'power.step.intro': 'Pick the PDU for each plug. The next free outlet is assigned automatically.', 'power.step.plug': 'Plug {index}', 'power.step.pdu': 'PDU', 'power.step.outlet': 'Outlet', 'power.step.unplugged': 'Not connected', 'power.step.auto': 'Outlet {outlet} (auto)', 'power.step.free': '{count} free', 'power.step.full': 'No free outlets on {pdu}: the plug stays “Not connected”.', 'power.step.unpluggedWarning': '{count} plug(s) not connected. You can still save.', 'power.step.noRedundancy': 'This rack has no UPS: the device has no redundant feed.', 'power.step.noPower': 'No power: this device has no plugs.', 'power.step.save': 'Save connections', 'power.step.skip': 'Not now', 'power.step.saving': 'Saving…', 'power.step.moved': 'The device moved rack: its previous connections were removed.', 'power.step.open': 'Power connections', 'power.estimateNote': 'Estimated values', 'power.error.open': 'Could not open the power connections.', 'power.error.save': 'Could not save the power connections.', 'power.error.upsFirst': 'Disconnect the devices from the UPS before switching to “Mains only”.', 'power.error.disconnectAll': 'Could not disconnect the devices from the UPS.',
    'rack.view': 'View', 'rack.view.front': 'Front', 'rack.view.rear': 'Rear', 'rack.view.both': 'Both', 'rack.zoom': 'Zoom', 'rack.zoomPanel': 'Rack zoom', 'rack.zoomLevel': 'Zoom level', 'rack.zoomFit': 'Fit to screen', 'rack.back': 'Back to racks', 'rack.edit': 'Edit rack', 'rack.delete': 'Delete rack', 'rack.deleting': 'Deleting…', 'device.noFrontImage': 'No front image', 'device.noRearImage': 'No rear image',
    'audit.userFilterPlaceholder': 'Name or username',
    'settings.title': 'Settings', 'settings.kicker': 'PLATFORM CONFIGURATION', 'settings.organization': 'Organization', 'settings.sites': 'Sites', 'settings.users': 'Users and roles', 'settings.discovery': 'Discovery', 'settings.snmp': 'SNMP', 'settings.audit': 'Audit', 'settings.searchPlaceholder': 'Search for a setting…', 'settings.searchResults': 'Matching settings', 'settings.noResults': 'No matching settings.',
    'settings.orgTitle': 'Organization details', 'settings.name': 'Name', 'settings.code': 'Code', 'settings.timezone': 'Time zone', 'settings.language': 'Application language', 'settings.pt': 'Português (Portugal)', 'settings.en': 'English (United States)',
    'settings.sitesTitle': 'Operational locations', 'settings.newSite': 'New Site', 'settings.noSites': 'There are no Sites yet.', 'settings.location': 'Location', 'settings.inventory': 'Inventory', 'settings.emptyOnly': 'Only Sites without inventory can be deleted.', 'settings.confirmCode': 'Enter the Site code to confirm', 'settings.buildings': 'buildings', 'settings.equipment': 'equipment', 'settings.address': 'Address', 'settings.city': 'City', 'settings.region': 'Region', 'settings.country': 'Country',
    'settings.usersTitle': 'Application access', 'settings.searchUsers': 'Search user or email…', 'settings.directRoles': 'Direct roles', 'settings.inheritedRoles': 'Inherited roles', 'settings.noUsers': 'No users were found.', 'settings.kcUnavailable': 'Keycloak administration is not configured for this installation.', 'settings.userCount': 'users', 'role.ADMIN': 'Administrator', 'role.NETWORK_OPERATOR': 'Network operator', 'role.SYSTEMS_OPERATOR': 'Systems operator', 'role.STORAGE_OPERATOR': 'Storage operator', 'role.AUDITOR': 'Auditor', 'role.READ_ONLY': 'Read only',
    'settings.discoveryTitle': 'Defaults for new discoveries', 'settings.methods': 'Methods', 'settings.ports': 'TCP ports', 'settings.reverseDns': 'Resolve names using reverse DNS', 'settings.interval': 'Default interval', 'settings.newOnly': 'Only applies to new runs and schedules.', 'settings.allowedCidrs': 'Networks allowed for Discovery', 'settings.allowedCidrsHint': 'One CIDR per line. Internal public networks require explicit ADMIN approval.',
    'settings.snmpListeners': 'SNMP listen interfaces', 'settings.snmpListenersHint': 'Choose the host IPs where devices send traps and informs.', 'settings.snmpListenMode': 'Listen mode', 'settings.snmpListenAll': 'All interfaces', 'settings.snmpListenSelected': 'Selected interfaces', 'settings.snmpListenSelectedHint': 'More than one address can be selected.', 'settings.snmpAvailableInterfaces': 'Interfaces available on the host', 'settings.snmpInternal': 'internal', 'settings.snmpNoInterfaces': 'No host interfaces available', 'settings.snmpNoInterfacesHint': 'Start npm run snmp:host-agent on the host and refresh this page.', 'settings.snmpApplyHint': 'The host agent reapplies the configuration within 30 seconds.', 'settings.snmpSaveError': 'Could not save the SNMP listen interfaces.',
    'settings.auditTitle': 'Event retention', 'settings.retention': 'Retention days', 'settings.totalEvents': 'Stored events', 'settings.oldestEvent': 'Oldest event', 'settings.lastCleanup': 'Last cleanup', 'settings.nextCleanup': 'Next cleanup',
    'setup.language': 'Application language', 'setup.welcome': 'Let’s prepare your workspace.', 'setup.organization': 'Organization', 'setup.firstSite': 'First site', 'setup.finish': 'Finish', 'setup.welcomeStep': 'Welcome', 'setup.asideDescription': 'Before managing infrastructure, we need to know which organization and locations own this inventory.', 'setup.firstRun': 'FIRST RUN', 'setup.welcomeTitle': 'Welcome to COCiber Management.', 'setup.welcomeDescription': 'This assistant creates the minimum application configuration without inventing equipment, networks, or data. You can complete the inventory later.', 'setup.start': 'Start', 'setup.step1': 'STEP 1 OF 3', 'setup.orgQuestion': 'What is the organization called?', 'setup.orgDescription': 'This name will be used in the application header and operational context.', 'setup.orgName': 'Organization name', 'setup.orgNameExample': 'E.g. Cybersecurity Operations Center', 'setup.shortCode': 'Short code', 'setup.shortCodeExample': 'E.g. COCIBER', 'setup.timezone': 'Time zone', 'setup.back': 'Back', 'setup.continue': 'Continue', 'setup.saving': 'Saving...', 'setup.step2': 'STEP 2 OF 3', 'setup.siteTitle': 'Register the first site.', 'setup.siteDescription': 'A site represents an operational location. The building, room, and rack are optional and can be filled in now or later.', 'setup.siteName': 'Site name', 'setup.siteNameExample': 'E.g. Lisbon HQ', 'setup.siteCode': 'Site code', 'setup.siteCodeExample': 'E.g. LIS-01', 'setup.address': 'Address', 'setup.addressExample': 'Street and number', 'setup.city': 'City', 'setup.region': 'Region', 'setup.country': 'Country', 'setup.optionalHierarchy': 'Optional physical hierarchy', 'setup.building': 'Building', 'setup.buildingExample': 'E.g. Main building', 'setup.room': 'Room', 'setup.roomExample': 'E.g. Server room', 'setup.rack': 'First rack', 'setup.rackExample': 'E.g. RACK-01', 'setup.creating': 'Creating...', 'setup.createSite': 'Create site', 'setup.step3': 'STEP 3 OF 3', 'setup.ready': 'The foundation is ready.', 'setup.readyDescription': '{organization} now has the site {site} ({code}). You can now start registering VLANs, subnets, equipment, and links.', 'setup.finishing': 'Finishing...', 'setup.enter': 'Enter the application', 'setup.preparing': 'Preparing the initial configuration...', 'setup.adminTitle': 'Administrator intervention is required.', 'setup.adminDescription': 'The first configuration of this installation can only be completed by a user with the ADMIN role.',
  },
};

type MessageParams = Record<string, string | number>;
type I18nValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: string, fallback?: string, params?: MessageParams) => string;
  formatDate: (value?: string | Date | null) => string;
  formatNumber: (value: number) => string;
};
const I18nContext = createContext<I18nValue | undefined>(undefined);

const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const translatedText = new WeakMap<Text, string>();
const translatedAttributeValues = new WeakMap<Element, Map<string, string>>();
const translatedAttributes = ['aria-label', 'placeholder', 'title'] as const;

export function translateLegacyDom(locale: AppLocale, root: Node) {
  const translateNode = (node: Text) => {
    const current = node.nodeValue ?? '';
    const previousTranslation = translatedText.get(node);
    if (!originalText.has(node) || (previousTranslation !== undefined && current !== previousTranslation)) {
      // React may reuse a text node for new state. Treat that value as the new
      // source instead of restoring the text that was first rendered here.
      originalText.set(node, current);
    }
    const source = originalText.get(node) ?? current;
    const next = translateLegacyText(locale, source);
    if (current !== next) node.nodeValue = next;
    translatedText.set(node, next);
  };
  const translateElement = (element: Element) => {
    let saved = originalAttributes.get(element);
    if (!saved) { saved = new Map(); originalAttributes.set(element, saved); }
    let translated = translatedAttributeValues.get(element);
    if (!translated) { translated = new Map(); translatedAttributeValues.set(element, translated); }
    for (const attribute of translatedAttributes) {
      if (!element.hasAttribute(attribute)) continue;
      const current = element.getAttribute(attribute) ?? '';
      const previousTranslation = translated.get(attribute);
      if (!saved.has(attribute) || (previousTranslation !== undefined && current !== previousTranslation)) saved.set(attribute, current);
      const source = saved.get(attribute) ?? '';
      const next = translateLegacyText(locale, source);
      if (current !== next) element.setAttribute(attribute, next);
      translated.set(attribute, next);
    }
  };
  if (root.nodeType === Node.TEXT_NODE) translateNode(root as Text);
  if (root.nodeType === Node.ELEMENT_NODE) translateElement(root as Element);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current.nodeType === Node.TEXT_NODE) translateNode(current as Text);
    else translateElement(current as Element);
  }
}

export function observeLegacyDom(locale: AppLocale, root: Node) {
  let translating = false;
  const apply = (node: Node) => {
    if (translating) return;
    translating = true;
    translateLegacyDom(locale, node);
    translating = false;
  };
  apply(root);
  const observer = new MutationObserver((mutations) => {
    if (translating) return;
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') apply(mutation.target);
      if (mutation.type === 'attributes') apply(mutation.target);
      for (const node of mutation.addedNodes) apply(node);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...translatedAttributes] });
  return () => observer.disconnect();
}

/** The organization locale to apply, or null when setup has not saved one (same rule as before). */
export function organizationLocaleFrom(status: { setupCompleted: boolean; organizationName?: string | null; locale?: string | null } | null | undefined): AppLocale | null {
  if (!status || !hasSavedOrganizationLocale(status)) return null;
  return status.locale === 'pt-PT' || status.locale === 'en-US' ? status.locale : null;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { setupStatus } = useAuth();
  const [locale, setLocaleState] = useState<AppLocale>('pt-PT');
  const setLocale = useCallback((next: AppLocale) => { setLocaleState(next); if (typeof window !== 'undefined') window.localStorage.setItem('cociber.locale', next); }, []);
  useEffect(() => { const stored = window.localStorage.getItem('cociber.locale'); setLocaleState(stored === 'pt-PT' || stored === 'en-US' ? stored : getConfiguredLocale()); }, []);
  // The organization's saved locale comes with the setup status that AuthProvider loads with the
  // identity, before the app renders. It used to be a second request (/settings/organization)
  // made only after /setup/status answered, with the whole app held behind a spinner meanwhile.
  const organizationLocale = organizationLocaleFrom(setupStatus);
  const [appliedOrganizationLocale, setAppliedOrganizationLocale] = useState<AppLocale | null>(null);
  if (organizationLocale && organizationLocale !== appliedOrganizationLocale) {
    // Adjust state while rendering, so the first render of the app already uses this locale.
    setAppliedOrganizationLocale(organizationLocale);
    setLocaleState(organizationLocale);
  }
  useEffect(() => {
    if (organizationLocale) window.localStorage.setItem('cociber.locale', organizationLocale);
  }, [organizationLocale]);
  useEffect(() => {
    document.documentElement.lang = locale;
    const applyMetadata = () => {
      document.title = locale === 'pt-PT' ? 'COCiber · Gestão de Infraestrutura' : 'COCiber · Infrastructure Management';
      document.querySelector('meta[name="description"]')?.setAttribute('content', locale === 'pt-PT' ? 'Centro de operações para infraestrutura e ciberdefesa.' : 'Operations center for infrastructure and cyber defense.');
    };
    applyMetadata();
    const frame = window.requestAnimationFrame(applyMetadata);
    return () => window.cancelAnimationFrame(frame);
  }, [locale]);
  useEffect(() => {
    return observeLegacyDom(locale, document.body);
  }, [locale]);
  // Keep the shared date/number formatters on the active language before children render.
  setFormatLocale(locale);
  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale,
    t: (key, fallback, params = {}) => {
      const count = typeof params.count === 'number' ? params.count : undefined;
      const pluralKey = count === undefined ? key : `${key}.${new Intl.PluralRules(locale).select(count)}`;
      const template = messages[locale][pluralKey] ?? messages[locale][key] ?? messages['pt-PT'][pluralKey] ?? messages['pt-PT'][key] ?? fallback ?? key;
      return Object.entries(params).reduce((text, [name, replacement]) => text.replaceAll(`{${name}}`, String(replacement)), template);
    },
    formatDate: (input) => input ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(input)) : '—',
    formatNumber: (input) => new Intl.NumberFormat(locale).format(input),
  }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() { const value = useContext(I18nContext); if (!value) throw new Error('useI18n must be used inside I18nProvider'); return value; }
