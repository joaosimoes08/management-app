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
  updatedAt?: string | null;
  refreshSeconds?: number;
};

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

/** Copy-ready Cisco IOS-XE lines for SNMPv3 authPriv polling and traps to this app; v2c only when the lab flag is on. */
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
    'snmp-server enable traps snmp authentication linkdown linkup coldstart warmstart',
    'snmp-server enable traps envmon',
    'snmp-server enable traps entity-sensor',
    'snmp-server enable traps fru-ctrl',
    'snmp-server enable traps stackwise',
    'snmp-server enable traps cpu threshold',
    'snmp-server enable traps errdisable',
    'snmp-server enable traps config',
    `snmp-server host ${receiver} version 3 priv ${user}${portSuffix}`,
  ].join('\n');
  const informs = input.engineId ? [
    `snmp-server engineID remote ${receiver}${portSuffix} ${input.engineId}`,
    `snmp-server user ${user} MGMT-APP remote ${receiver}${portSuffix} v3 auth ${auth} <AUTH-KEY> priv ${priv} <PRIV-KEY>`,
    `snmp-server host ${receiver} informs version 3 priv ${user}${portSuffix}`,
  ].join('\n') : null;
  const v2c = input.v2cAllowed ? [
    '! Só laboratório: SNMPv2c envia a comunidade em claro.',
    'snmp-server community <COMUNIDADE> RO MGMT-APP-SNMP',
    `snmp-server host ${receiver} version 2c <COMUNIDADE>${portSuffix}`,
  ].join('\n') : null;
  return { v3, informs, v2c };
}

export type SnmpJobView = { id: string; type: string; status: string; errorCode?: string | null; createdAt: string; startedAt?: string | null; completedAt?: string | null; result?: unknown };

export type CredentialTestView =
  | { state: 'running'; label: string }
  | { state: 'ok'; label: string; detail: string }
  | { state: 'timeout' | 'auth' | 'failed'; label: string; detail: string };

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
export function describeCredentialTest(job: SnmpJobView, format: (ms: number) => string = (ms) => `${ms} ms`): CredentialTestView {
  if (job.status === 'PENDING' || job.status === 'RUNNING') return { state: 'running', label: 'A testar…' };
  const ms = elapsed(job);
  const time = ms === null ? '' : format(ms);
  if (job.status === 'COMPLETED') {
    const sysName = resultField<string>(job.result, 'sysName');
    return { state: 'ok', label: 'OK', detail: [time, sysName ? `sysName ${sysName}` : 'sysName não devolvido'].filter(Boolean).join(' · ') };
  }
  const code = job.errorCode ?? '';
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
