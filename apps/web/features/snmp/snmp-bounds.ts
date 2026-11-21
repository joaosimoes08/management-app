/** Input bounds enforced by the SNMP API (PR #85); mirrored here so the forms fail early with a clear message. */
export const snmpConfigBounds = {
  port: { min: 1, max: 65535 },
  intervalMinutes: { min: 5, max: 1440 },
  timeoutMs: { min: 500, max: 30000 },
  retries: { min: 0, max: 5 },
} as const;

export const snmpCredentialBounds = {
  label: { max: 120 },
  username: { max: 64 },
  secret: { min: 8, max: 255 },
} as const;

type ConfigValues = { port: number; intervalMinutes: number; timeoutMs: number; retries: number };
const configLabels: Record<keyof typeof snmpConfigBounds, string> = { port: 'Porta', intervalMinutes: 'Intervalo (min)', timeoutMs: 'Timeout (ms)', retries: 'Retries' };

/** First out-of-range polling field as a message, or '' when the config is valid. */
export function snmpConfigError(config: ConfigValues): string {
  for (const key of Object.keys(snmpConfigBounds) as Array<keyof typeof snmpConfigBounds>) {
    const { min, max } = snmpConfigBounds[key];
    const value = config[key];
    if (!Number.isInteger(value) || value < min || value > max) return `${configLabels[key]}: indica um número inteiro entre ${min} e ${max}.`;
  }
  return '';
}

type CredentialValues = { version: string; label?: string; username?: string; community?: string; authKey?: string; privKey?: string };

/** First invalid credential field as a message, or '' when the credential can be sent. */
export function snmpCredentialError(credential: CredentialValues): string {
  const { secret } = snmpCredentialBounds;
  if ((credential.label ?? '').length > snmpCredentialBounds.label.max) return `A etiqueta tem no máximo ${snmpCredentialBounds.label.max} caracteres.`;
  if (credential.version === 'V2C') {
    const community = credential.community ?? '';
    if (community.length < secret.min || community.length > secret.max) return `A comunidade deve ter entre ${secret.min} e ${secret.max} caracteres.`;
    return '';
  }
  const username = (credential.username ?? '').trim();
  if (!username || username.length > snmpCredentialBounds.username.max) return `O username SNMPv3 é obrigatório e tem no máximo ${snmpCredentialBounds.username.max} caracteres.`;
  for (const [value, label] of [[credential.authKey ?? '', 'auth key'], [credential.privKey ?? '', 'privacy key']] as const) {
    if (value.length < secret.min || value.length > secret.max) return `A ${label} deve ter entre ${secret.min} e ${secret.max} caracteres.`;
  }
  return '';
}
