export type ApiErrorPayload = {
  code?: string;
  message?: string | string[];
  error?: string;
  /** PORT_LAYOUT_INCOMPLETE details: the face with half-mapped ports, or the totals. */
  face?: string;
  partialPorts?: number;
  expected?: number;
  mapped?: number;
  /** PORT_LAYOUT_CONFLICT: the current revision. */
  revision?: string;
  /**
   * Extra data some errors carry, e.g. CRITICAL_ASSET_ATTESTATION_ALREADY_RECORDED (the cycle that was
   * already reviewed and by whom), PDU_HAS_CONNECTIONS (the devices still plugged in) or
   * IP_RANGE_EXHAUSTED (`available`: free addresses left in the requested range).
   */
  details?: { attestationId?: string; weekStart?: string; outcome?: string | null; confirmedAt?: string | null; confirmedBy?: string | null; confirmedByName?: string | null; available?: number } & Record<string, unknown>;
};

export const localizedApiErrors: Record<string, Record<string, string>> = {
  'pt-PT': {
    APPLICATION_ROLE_REQUIRED: 'O utilizador tem de manter pelo menos uma role da aplicação.',
    KEYCLOAK_ADMIN_AUTH_FAILED: 'Não foi possível autenticar o serviço administrativo no Keycloak.',
    KEYCLOAK_ADMIN_NOT_CONFIGURED: 'A integração administrativa do Keycloak não está configurada.',
    KEYCLOAK_ADMIN_REQUEST_FAILED: 'O Keycloak recusou a operação administrativa.',
    LAST_ADMIN_REQUIRED: 'Não é possível remover a role do último administrador ativo.',
    ROLE_REQUEST_INVALID: 'A seleção de roles não é válida.',
    ROLE_ALREADY_HELD: 'Já tens uma ou mais das roles pedidas.',
    ROLE_REQUEST_PENDING: 'Já existe um pedido de roles pendente.',
    ROLE_REQUEST_NOT_PENDING: 'Este pedido já foi processado.',
    SITE_NOT_EMPTY: 'Só é possível eliminar Sites vazios.',
    TCP_PORT_REQUIRED: 'Define pelo menos uma porta para Discovery TCP.',
    DISCOVERY_TARGET_FORBIDDEN: 'A rede pertence ou sobrepõe uma gama especial bloqueada.',
    DISCOVERY_TARGET_NOT_ALLOWED: 'A subnet não está incluída nas redes autorizadas para Discovery.',
    DISCOVERY_IPV6_UNSUPPORTED: 'A enumeração de subnets IPv6 ainda não é suportada.',
    DISCOVERY_PORT_LIMIT: 'Discovery aceita no máximo 64 portas por execução.',
    DISCOVERY_ALREADY_ACTIVE: 'Já existe uma execução ativa para esta subnet.',
    IPAM_SCOPE_FORBIDDEN: 'Não tens permissão para esta operação neste scope IPAM.',
    IPAM_SCOPE_SITE_MISMATCH: 'O scope não pertence ao Site do grupo.',
    IPAM_PLACEMENT_SITE_MISMATCH: 'Site, VLAN, VRF e subnet pai têm de pertencer ao mesmo Site.',
    RIPE_PASTE_NO_VALID_PREFIX: 'A lista não tem nenhum prefixo válido. Usa notação CIDR com comprimento, por exemplo 193.0.0.0/21 ou 2001:db8::/32.',
    RIPE_PASTE_TOO_MANY: 'A lista tem demasiados prefixos: o máximo é 500 por pré-visualização. Divide-a em várias listas.',
    RIPE_PREVIEW_TARGET_MISMATCH: 'O Site ou VRF mudou depois da pré-visualização. Pré-visualiza novamente antes de importar.',
    SERVICE_PORT_REQUIRED: 'Services TCP/UDP exigem uma porta.',
    DEVICE_HOST_CONFLICT: 'O equipamento já está associado a outro Host.',
    VALIDATION_ERROR: 'Existem campos inválidos no pedido.',
    PORT_LAYOUT_INCOMPLETE: 'O mapeamento de portas está incompleto: o total das faces frontal e traseira tem de ser igual ao número de portas do modelo.',
    FRONT_IMAGE_REQUIRED: 'A imagem frontal é obrigatória. Escolhe ou carrega uma imagem frontal para o modelo.',
    PORT_LAYOUT_DUPLICATE_PORT: 'Há uma porta mapeada mais de uma vez. Cada porta só pode estar numa face.',
    PORT_LAYOUT_TOO_MANY_PORTS: 'O mapa tem mais portas do que o modelo. Remove as portas a mais.',
    PORT_LAYOUT_CONFLICT: 'Alterado por outra pessoa — recarrega.',
    ASSET_NOT_IMAGE: 'O ficheiro escolhido não é uma imagem. Escolhe uma imagem PNG, JPG, SVG ou WebP.',
    CRITICAL_ASSET_ATTESTATION_ALREADY_RECORDED: 'A revisão desta semana já foi registada. Não é possível registar outra para o mesmo ciclo.',
  },
  'en-US': {
    APPLICATION_ROLE_REQUIRED: 'The user must retain at least one application role.',
    KEYCLOAK_ADMIN_AUTH_FAILED: 'The Keycloak administration service could not authenticate.',
    KEYCLOAK_ADMIN_NOT_CONFIGURED: 'The Keycloak administration integration is not configured.',
    KEYCLOAK_ADMIN_REQUEST_FAILED: 'Keycloak rejected the administrative operation.',
    LAST_ADMIN_REQUIRED: 'The role cannot be removed from the last active administrator.',
    ROLE_REQUEST_INVALID: 'The role selection is invalid.',
    ROLE_ALREADY_HELD: 'You already have one or more requested roles.',
    ROLE_REQUEST_PENDING: 'There is already a pending role request.',
    ROLE_REQUEST_NOT_PENDING: 'This request has already been processed.',
    SITE_NOT_EMPTY: 'Only empty Sites can be deleted.',
    TCP_PORT_REQUIRED: 'Define at least one port for TCP Discovery.',
    DISCOVERY_TARGET_FORBIDDEN: 'The network belongs to or overlaps a blocked special range.',
    DISCOVERY_TARGET_NOT_ALLOWED: 'The subnet is not included in the Discovery allowlist.',
    DISCOVERY_IPV6_UNSUPPORTED: 'IPv6 subnet enumeration is not supported yet.',
    DISCOVERY_PORT_LIMIT: 'Discovery accepts at most 64 ports per run.',
    DISCOVERY_ALREADY_ACTIVE: 'There is already an active run for this subnet.',
    IPAM_SCOPE_FORBIDDEN: 'You do not have permission for this operation in this IPAM scope.',
    IPAM_SCOPE_SITE_MISMATCH: 'The scope does not belong to the group Site.',
    IPAM_PLACEMENT_SITE_MISMATCH: 'Site, VLAN, VRF, and parent subnet must belong to the same Site.',
    RIPE_PASTE_NO_VALID_PREFIX: 'The list has no valid prefix. Use CIDR notation with a length, for example 193.0.0.0/21 or 2001:db8::/32.',
    RIPE_PASTE_TOO_MANY: 'The list has too many prefixes: the maximum is 500 per preview. Split it into several lists.',
    RIPE_PREVIEW_TARGET_MISMATCH: 'The Site or VRF changed after the preview. Preview again before importing.',
    SERVICE_PORT_REQUIRED: 'TCP/UDP Services require a port.',
    DEVICE_HOST_CONFLICT: 'The device is already linked to another Host.',
    VALIDATION_ERROR: 'The request contains invalid fields.',
    PORT_LAYOUT_INCOMPLETE: 'Port mapping is incomplete: the front and rear faces together must match the model port count.',
    FRONT_IMAGE_REQUIRED: 'A front image is required. Choose or upload a front image for the model.',
    PORT_LAYOUT_DUPLICATE_PORT: 'A port is mapped more than once. Each port can only be on one face.',
    PORT_LAYOUT_TOO_MANY_PORTS: 'The map has more ports than the model. Remove the extra ports.',
    PORT_LAYOUT_CONFLICT: 'Changed by someone else — reload.',
    ASSET_NOT_IMAGE: 'The chosen file is not an image. Choose a PNG, JPG, SVG or WebP image.',
    CRITICAL_ASSET_ATTESTATION_ALREADY_RECORDED: 'This week\'s review has already been recorded. Another one cannot be recorded for the same cycle.',
  },
};

export type ApiLocale = 'pt-PT' | 'en-US';

const FACE_NAMES: Record<ApiLocale, Record<string, string>> = {
  'pt-PT': { front: 'frontal', rear: 'traseira' },
  'en-US': { front: 'front', rear: 'rear' },
};

/**
 * PORT_LAYOUT_INCOMPLETE comes with details (which face, or the totals); keep them instead of the generic text.
 * The API writes its messages in Portuguese, so English is rebuilt from the structured fields.
 */
function portLayoutIncompleteMessage(payload: ApiErrorPayload, locale: ApiLocale): string | undefined {
  const face = payload.face ? FACE_NAMES[locale][payload.face] ?? payload.face : undefined;
  if (locale === 'pt-PT') {
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
    if (face && payload.partialPorts) return `${payload.partialPorts} porta(s) da face ${face} não estão completamente mapeadas.`;
  } else if (face && payload.partialPorts) {
    return `${payload.partialPorts} port(s) on the ${face} face are not fully mapped (port key, position and size).`;
  }
  if (typeof payload.expected === 'number' && typeof payload.mapped === 'number') {
    return locale === 'pt-PT'
      ? `O modelo tem ${payload.expected} portas de rede mas só ${payload.mapped} estão mapeadas (frente + traseira).`
      : `The model has ${payload.expected} network ports but only ${payload.mapped} are mapped (front + rear).`;
  }
  return undefined;
}

/** The API's Portuguese text already names the week and reviewer; English is rebuilt from `details`. */
function attestationAlreadyRecordedMessage(payload: ApiErrorPayload, locale: ApiLocale): string | undefined {
  if (locale === 'pt-PT') return typeof payload.message === 'string' && payload.message.trim() ? payload.message : undefined;
  const week = payload.details?.weekStart;
  if (!week) return undefined;
  const by = payload.details?.confirmedByName ? ` by ${payload.details.confirmedByName}` : '';
  // weekStart is a calendar date (YYYY-MM-DD); format it in UTC so it never shifts a day.
  const date = new Date(week.length === 10 ? `${week}T00:00:00Z` : week);
  const label = Number.isNaN(date.getTime()) ? week : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
  return `The review for the week of ${label} was already recorded${by}. Another one cannot be recorded for the same cycle.`;
}

/** Text shown for an API error: specific details first, then the translated code, then the API message. */
export function apiErrorMessage(payload: ApiErrorPayload, locale: ApiLocale): string {
  const specific = payload.code === 'PORT_LAYOUT_INCOMPLETE' ? portLayoutIncompleteMessage(payload, locale)
    : payload.code === 'CRITICAL_ASSET_ATTESTATION_ALREADY_RECORDED' ? attestationAlreadyRecordedMessage(payload, locale)
    : undefined;
  return specific
    || (payload.code && localizedApiErrors[locale][payload.code])
    || (Array.isArray(payload.message) ? payload.message.join(', ') : payload.message ?? payload.error ?? '');
}

/** Error thrown by apiFetch; keeps the HTTP status and the API code so callers can react to e.g. 409 conflicts. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly payload?: ApiErrorPayload;
  constructor(message: string, status: number, payload?: ApiErrorPayload) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = payload?.code;
    this.payload = payload;
  }
}
