'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { translateLegacyText } from './legacy-messages';
import { apiFetch } from '@/lib/api/client';

export type AppLocale = 'pt-PT' | 'en-US';
const messages: Record<AppLocale, Record<string, string>> = {
  'pt-PT': {
    'settings.finish': 'Concluir',
    'profile.menu': 'Definições do perfil', 'profile.title': 'Perfil', 'profile.kicker': 'CONTA E ACESSOS', 'profile.tabs.profile': 'Perfil', 'profile.tabs.roles': 'Solicitar roles', 'profile.username': 'Utilizador', 'profile.roles': 'Roles atuais', 'profile.rolesTitle': 'Solicitar acesso adicional', 'profile.rolesDescription': 'Seleciona as roles que precisas. Um administrador irá analisar o pedido.', 'profile.submit': 'Enviar pedido', 'profile.pending': 'Pedido pendente', 'profile.processing': 'Pedido em processamento', 'profile.alreadyAssigned': 'Já atribuída', 'profile.requestSent': 'Pedido enviado', 'profile.loadError': 'Não foi possível carregar o perfil.', 'profile.submitError': 'Não foi possível enviar o pedido.', 'profile.history': 'Histórico de pedidos', 'profile.noHistory': 'Ainda não existem pedidos.', 'profile.status.PENDING': 'Pendente', 'profile.status.PROCESSING': 'Em processamento', 'profile.status.APPROVED': 'Aprovado', 'profile.status.REJECTED': 'Rejeitado', 'settings.requested': 'Solicitou', 'settings.requestProcessing': 'Pedido em processamento', 'settings.accept': 'Aceitar', 'settings.reject': 'Rejeitar', 'settings.requestApproved': 'Pedido aprovado', 'settings.requestRejected': 'Pedido rejeitado', 'settings.requestDecisionError': 'Não foi possível decidir o pedido.',
    'common.save': 'Guardar alterações', 'common.cancel': 'Cancelar', 'common.edit': 'Editar', 'common.delete': 'Eliminar', 'common.refresh': 'Atualizar', 'common.loading': 'A carregar…', 'common.previous': 'Anterior', 'common.next': 'Seguinte',
    'nav.dashboard': 'Dashboard', 'nav.infrastructure': 'Infraestrutura', 'nav.portal': 'Portal interno', 'nav.ipam': 'IPAM', 'nav.discovery': 'Descoberta', 'nav.snmp': 'SNMP', 'nav.audit': 'Auditoria', 'nav.settings': 'Definições', 'nav.help': 'Ajuda e suporte',
    'shell.activeSite': 'Site ativo', 'shell.allSites': 'Todos os Sites', 'shell.globalView': 'Visão global da organização', 'shell.createSite': 'Criar novo Site', 'shell.addLocation': 'Adicionar uma localização operacional', 'shell.nextSteps': 'Próximos passos', 'shell.continueIpam': 'Continue a configurar o inventário IPAM.',
    'shell.operational': 'Ambiente operacional', 'shell.degraded': 'Ambiente degradado', 'shell.unavailable': 'Ambiente indisponível', 'shell.setup': 'Configuração inicial', 'shell.setupComplete': 'Concluída', 'shell.setupPending': 'Pendente', 'shell.updated': 'Atualizado',
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
    'settings.finish': 'Finish',
    'profile.menu': 'Profile settings', 'profile.title': 'Profile', 'profile.kicker': 'ACCOUNT AND ACCESS', 'profile.tabs.profile': 'Profile', 'profile.tabs.roles': 'Request roles', 'profile.username': 'User', 'profile.roles': 'Current roles', 'profile.rolesTitle': 'Request additional access', 'profile.rolesDescription': 'Select the roles you need. An administrator will review your request.', 'profile.submit': 'Send request', 'profile.pending': 'Pending request', 'profile.processing': 'Request processing', 'profile.alreadyAssigned': 'Already assigned', 'profile.requestSent': 'Request sent', 'profile.loadError': 'Could not load your profile.', 'profile.submitError': 'Could not submit the request.', 'profile.history': 'Request history', 'profile.noHistory': 'No requests yet.', 'profile.status.PENDING': 'Pending', 'profile.status.PROCESSING': 'Processing', 'profile.status.APPROVED': 'Approved', 'profile.status.REJECTED': 'Rejected', 'settings.requested': 'Requested', 'settings.requestProcessing': 'Request processing', 'settings.accept': 'Accept', 'settings.reject': 'Reject', 'settings.requestApproved': 'Request approved', 'settings.requestRejected': 'Request rejected', 'settings.requestDecisionError': 'Could not decide the request.',
    'common.save': 'Save changes', 'common.cancel': 'Cancel', 'common.edit': 'Edit', 'common.delete': 'Delete', 'common.refresh': 'Refresh', 'common.loading': 'Loading…', 'common.previous': 'Previous', 'common.next': 'Next',
    'nav.dashboard': 'Dashboard', 'nav.infrastructure': 'Infrastructure', 'nav.portal': 'Internal portal', 'nav.ipam': 'IPAM', 'nav.discovery': 'Discovery', 'nav.snmp': 'SNMP', 'nav.audit': 'Audit', 'nav.settings': 'Settings', 'nav.help': 'Help and support',
    'shell.activeSite': 'Active site', 'shell.allSites': 'All Sites', 'shell.globalView': 'Organization-wide view', 'shell.createSite': 'Create new Site', 'shell.addLocation': 'Add an operational location', 'shell.nextSteps': 'Next steps', 'shell.continueIpam': 'Continue configuring the IPAM inventory.',
    'shell.operational': 'Operational environment', 'shell.degraded': 'Degraded environment', 'shell.unavailable': 'Environment unavailable', 'shell.setup': 'Initial setup', 'shell.setupComplete': 'Completed', 'shell.setupPending': 'Pending', 'shell.updated': 'Updated',
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
const translatedAttributes = ['aria-label', 'placeholder', 'title'] as const;

function translateLegacyDom(locale: AppLocale, root: Node) {
  const translateNode = (node: Text) => {
    const source = originalText.get(node) ?? node.nodeValue ?? '';
    if (!originalText.has(node)) originalText.set(node, source);
    const next = translateLegacyText(locale, source);
    if (node.nodeValue !== next) node.nodeValue = next;
  };
  const translateElement = (element: Element) => {
    let saved = originalAttributes.get(element);
    if (!saved) { saved = new Map(); originalAttributes.set(element, saved); }
    for (const attribute of translatedAttributes) {
      if (!element.hasAttribute(attribute)) continue;
      if (!saved.has(attribute)) saved.set(attribute, element.getAttribute(attribute) ?? '');
      const source = saved.get(attribute) ?? '';
      const next = translateLegacyText(locale, source);
      if (element.getAttribute(attribute) !== next) element.setAttribute(attribute, next);
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

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { authenticated, loading: authLoading } = useAuth();
  const [locale, setLocaleState] = useState<AppLocale>('pt-PT'); const [loading, setLoading] = useState(false);
  const setLocale = useCallback((next: AppLocale) => { setLocaleState(next); if (typeof window !== 'undefined') window.localStorage.setItem('cociber.locale', next); }, []);
  useEffect(() => { const stored = window.localStorage.getItem('cociber.locale'); if (stored === 'pt-PT' || stored === 'en-US') setLocaleState(stored); }, []);
  useEffect(() => { if (!authenticated) return; let active = true; setLoading(true); void apiFetch<{ settings: { locale?: string } }>('/api/v1/settings/organization').then((result) => { if (active && (result.settings.locale === 'pt-PT' || result.settings.locale === 'en-US')) setLocale(result.settings.locale); }).catch(() => undefined).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [apiFetch, authenticated, setLocale]);
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
    let translating = false;
    const apply = (root: Node) => {
      if (translating) return;
      translating = true;
      translateLegacyDom(locale, root);
      translating = false;
    };
    apply(document.body);
    const observer = new MutationObserver((mutations) => {
      if (translating) return;
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') apply(mutation.target);
        if (mutation.type === 'attributes') apply(mutation.target);
        for (const node of mutation.addedNodes) apply(node);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...translatedAttributes] });
    return () => observer.disconnect();
  }, [locale]);
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
  if (!authLoading && authenticated && loading) return <div className="auth-loading"><div className="auth-spinner" /><span>{messages[locale]['common.loading']}</span></div>;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() { const value = useContext(I18nContext); if (!value) throw new Error('useI18n must be used inside I18nProvider'); return value; }
