/**
 * SNMP Phase 1 steps 3 and 4.2: pure helpers behind the switch-side setup panel and the inline credential test.
 * Nothing here holds or prints a secret: the Cisco lines use placeholders for every key and community.
 */

export type SnmpReceiverSettings = {
  listenAll: boolean;
  selectedInterfaceIds: string[];
  interfaces: Array<{ id: string; instanceId: string; name: string; address: string; internal: boolean; lastSeenAt: string }>;
  engineId?: string | null;
  engineIdSource?: 'ENV' | 'STORED' | null;
  trapPort?: number;
  v2cAllowed?: boolean;
  /** HOST_AGENT: addresses come from the host agent's interfaces. CONTAINER_INGRESS: from containerReceiver. */
  receiverMode?: 'HOST_AGENT' | 'CONTAINER_INGRESS';
  containerReceiver?: SnmpContainerReceiver | null;
  updatedAt?: string | null;
  refreshSeconds?: number;
};

export type SnmpContainerReceiver = {
  address: string | null;
  addressSource: 'SNMP_TRAP_PUBLIC_ADDRESS' | 'SNMP_TRAP_HOST_IP' | null;
  reason: 'SNMP_TRAP_PUBLIC_ADDRESS_REQUIRED' | 'SNMP_TRAP_PUBLIC_ADDRESS_INVALID' | null;
  port: number;
};

export type ContainerReceiverView =
  | { state: 'address'; address: string; port: number; display: string; source: string | null }
  | { state: 'missing'; reason: 'REQUIRED' | 'INVALID'; port: number; message: string };

export const CONTAINER_RECEIVER_REQUIRED = 'Sem endereço do recetor: o servidor não tem SNMP_TRAP_PUBLIC_ADDRESS definido. Define SNMP_TRAP_PUBLIC_ADDRESS no servidor com o IP ou o nome DNS para onde os switches enviam as traps e reinicia a app.';
export const CONTAINER_RECEIVER_INVALID = 'O valor de SNMP_TRAP_PUBLIC_ADDRESS no servidor não é um IP nem um nome DNS válido. Corrige SNMP_TRAP_PUBLIC_ADDRESS no servidor e reinicia a app.';

/**
 * Container-only receiver (no host agent): the address switches send to comes from the deployment, not from interfaces.
 * Returns null in host-agent mode (or with an older API), so the interface-based behaviour stays as it was.
 */
export function containerReceiverView(settings?: SnmpReceiverSettings | null): ContainerReceiverView | null {
  if (!settings || settings.receiverMode !== 'CONTAINER_INGRESS' || !settings.containerReceiver) return null;
  const { address, addressSource, reason, port } = settings.containerReceiver;
  const safePort = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 162;
  if (address) return { state: 'address', address, port: safePort, display: `${address.includes(':') ? `[${address}]` : address}:${safePort}`, source: addressSource };
  return reason === 'SNMP_TRAP_PUBLIC_ADDRESS_INVALID'
    ? { state: 'missing', reason: 'INVALID', port: safePort, message: CONTAINER_RECEIVER_INVALID }
    : { state: 'missing', reason: 'REQUIRED', port: safePort, message: CONTAINER_RECEIVER_REQUIRED };
}

const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/**
 * Addresses a switch can send traps to: the selected listener interfaces, or every non-internal host IPv4 address when
 * the receiver listens on all of them. Loopback and link-local addresses are never offered.
 */
export function receiverAddresses(settings?: SnmpReceiverSettings | null): string[] {
  if (!settings) return [];
  const interfaces = Array.isArray(settings.interfaces) ? settings.interfaces : [];
  const selected = Array.isArray(settings.selectedInterfaceIds) ? settings.selectedInterfaceIds : [];
  const pool = settings.listenAll ? interfaces.filter((item) => !item.internal) : interfaces.filter((item) => selected.includes(item.id));
  return [...new Set(pool.map((item) => item.address))].filter((address) => ipv4.test(address) && !address.startsWith('127.') && !address.startsWith('169.254.'));
}

export const RECEIVER_PLACEHOLDER = '<IP-DA-APP>';

const authKeyword: Record<string, string> = { SHA1: 'sha', SHA: 'sha', SHA256: 'sha-2 256', SHA384: 'sha-2 384', SHA512: 'sha-2 512' };
const privKeyword: Record<string, string> = { AES128: 'aes 128', AES: 'aes 128', AES256: 'aes 256' };

export type IosXeSetupInput = {
  receiver?: string | null;
  port?: number;
  username?: string | null;
  authProtocol?: string | null;
  privProtocol?: string | null;
  engineId?: string | null;
  v2cAllowed?: boolean;
};

/** The trap classes the app catalogues (snmp-core trap catalog); v3 and v2c enable the same set, never a bare "enable traps". */
const TRAP_CLASSES = [
    'snmp-server enable traps snmp authentication linkdown linkup coldstart warmstart',
    'snmp-server enable traps envmon',
    'snmp-server enable traps entity-sensor',
    'snmp-server enable traps fru-ctrl',
    'snmp-server enable traps stackwise',
    'snmp-server enable traps cpu threshold',
    'snmp-server enable traps errdisable',
    'snmp-server enable traps config',
];

/** Copy-ready Cisco IOS-XE lines for SNMPv3 authPriv polling and traps to this app, then v2c unless SNMP_ALLOW_V2C=false. */
export function iosXeSetupLines(input: IosXeSetupInput): { v3: string; informs: string | null; v2c: string | null } {
  const receiver = input.receiver || RECEIVER_PLACEHOLDER;
  const port = input.port ?? 162;
  const user = input.username?.trim() || 'mgmt-app';
  const auth = authKeyword[(input.authProtocol ?? 'SHA256').toUpperCase()] ?? 'sha-2 256';
  const priv = privKeyword[(input.privProtocol ?? 'AES128').toUpperCase()] ?? 'aes 128';
  const portSuffix = port === 162 ? '' : ` udp-port ${port}`;
  const v3 = [
    'ip access-list standard MGMT-APP-SNMP',
    ` permit host ${receiver}`,
    'snmp-server view MGMT-APP-VIEW iso included',
    'snmp-server group MGMT-APP v3 priv read MGMT-APP-VIEW access MGMT-APP-SNMP',
    `snmp-server user ${user} MGMT-APP v3 auth ${auth} <AUTH-KEY> priv ${priv} <PRIV-KEY> access MGMT-APP-SNMP`,
    'snmp-server ifindex persist',
    '! trap-source: a interface cujo IP é o IP de gestão deste equipamento na app',
    'snmp-server trap-source <INTERFACE-DE-GESTAO>',
    ...TRAP_CLASSES,
    `snmp-server host ${receiver} version 3 priv ${user}${portSuffix}`,
  ].join('\n');
  const informs = input.engineId ? [
    `snmp-server engineID remote ${receiver}${portSuffix} ${input.engineId}`,
    `snmp-server user ${user} MGMT-APP remote ${receiver}${portSuffix} v3 auth ${auth} <AUTH-KEY> priv ${priv} <PRIV-KEY>`,
    `snmp-server host ${receiver} informs version 3 priv ${user}${portSuffix}`,
  ].join('\n') : null;
  const v2c = input.v2cAllowed ? [
    '! SNMPv2c: a community segue em texto simples. Use apenas em redes de gestão isoladas.',
    'ip access-list standard MGMT-APP-SNMP-V2C',
    ` permit host ${receiver}`,
    'snmp-server community <COMMUNITY> RO MGMT-APP-SNMP-V2C',
    '! trap-source: a interface cujo IP é o IP de gestão deste equipamento na app',
    'snmp-server trap-source <INTERFACE-DE-GESTAO>',
    ...TRAP_CLASSES,
    `snmp-server host ${receiver} version 2c <COMMUNITY>${portSuffix}`,
  ].join('\n') : null;
  return { v3, informs, v2c };
}

export type SnmpJobView = { id: string; type: string; status: string; errorCode?: string | null; createdAt: string; startedAt?: string | null; completedAt?: string | null; result?: unknown };

export type CredentialTestView =
  | { state: 'running'; label: string }
  | { state: 'ok'; label: string; detail: string }
  | { state: 'timeout' | 'auth' | 'failed'; label: string; detail: string };

/** Longest the UI shows "A testar…" for one credential test (the API closes it after timeout + 10 s). */
export const CREDENTIAL_TEST_UI_LIMIT_MS = 60_000;

const timeoutCodes = new Set(['SNMP_TIMEOUT', 'SNMP_UNREACHABLE', 'SNMP_REQUEST_TIMEOUT']);
const authCodes = new Set(['SNMP_AUTHENTICATION_FAILED', 'SNMP_AUTH_FAILED', 'SNMP_UNKNOWN_USER', 'SNMP_DECRYPTION_FAILED']);

function resultField<T>(result: unknown, key: string): T | null {
  return result && typeof result === 'object' && key in result ? (result as Record<string, T>)[key] ?? null : null;
}

function elapsed(job: SnmpJobView): number | null {
  const recorded = resultField<number>(job.result, 'durationMs');
  if (typeof recorded === 'number') return recorded;
  if (job.startedAt && job.completedAt) return Math.max(0, Date.parse(job.completedAt) - Date.parse(job.startedAt));
  return null;
}

/** What the inline credential test shows for a CREDENTIAL_TEST job: running, OK, timeout, auth failure or other error. */
export function describeCredentialTest(job: SnmpJobView, format: (ms: number) => string = (ms) => `${ms} ms`, now = Date.now()): CredentialTestView {
  if (job.status === 'PENDING' || job.status === 'RUNNING') {
    // P0-3 follow-up: the API closes a test past its deadline; this stops "A testar…" even if that never happens.
    if (now - Date.parse(job.createdAt) <= CREDENTIAL_TEST_UI_LIMIT_MS) return { state: 'running', label: 'A testar…' };
    return { state: 'timeout', label: 'Sem resposta (timeout)', detail: 'O teste não terminou. Tenta de novo; se voltar a acontecer, confirma que o serviço SNMP está a correr.' };
  }
  const ms = elapsed(job);
  const time = ms === null ? '' : format(ms);
  if (job.status === 'COMPLETED') {
    const sysName = resultField<string>(job.result, 'sysName');
    return { state: 'ok', label: 'OK', detail: [time, sysName ? `sysName ${sysName}` : 'sysName não devolvido'].filter(Boolean).join(' · ') };
  }
  const code = job.errorCode ?? '';
  if (code === 'SNMP_WORKER_UNAVAILABLE') return { state: 'timeout', label: 'Sem resposta (timeout)', detail: [time, 'O serviço SNMP não processou o pedido a tempo. Confirma que o serviço SNMP está a correr e tenta de novo.'].filter(Boolean).join(' · ') };
  if (timeoutCodes.has(code)) return { state: 'timeout', label: 'Sem resposta (timeout)', detail: [time, 'Confirma o IP de gestão, a ACL e a porta UDP 161.'].filter(Boolean).join(' · ') };
  if (authCodes.has(code)) return { state: 'auth', label: 'Falha de autenticação', detail: [time, 'O utilizador, as chaves ou os protocolos não coincidem com o switch.'].filter(Boolean).join(' · ') };
  return { state: 'failed', label: 'Falhou', detail: [time, code || job.status].filter(Boolean).join(' · ') };
}

/** The job a click started (by id), else the newest job of that type. */
export function latestJob(jobs: SnmpJobView[] | undefined, type: string, id?: string): SnmpJobView | null {
  if (!jobs?.length) return null;
  if (id) return jobs.find((job) => job.id === id) ?? null;
  return jobs.filter((job) => job.type === type).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ?? null;
}

/** The stored outcome of the last test or poll with this credential, in words; never a generic "success". */
export function lastTestLabel(status?: string | null): string {
  if (status === 'COMPLETED') return 'último teste: OK';
  if (status === 'FAILED') return 'último teste: falhou';
  if (status === 'PENDING' || status === 'RUNNING') return 'teste em curso';
  if (status === 'BLOCKED') return 'último teste: bloqueado';
  return 'ainda não testada';
}
