import type { useUiText } from '@/components/ui/use-ui-text';

type Translate = ReturnType<typeof useUiText>;

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
const configLabels: Record<keyof typeof snmpConfigBounds, string> = { port: 'snmp.bounds.field.port', intervalMinutes: 'snmp.bounds.field.intervalMinutes', timeoutMs: 'snmp.bounds.field.timeoutMs', retries: 'snmp.bounds.field.retries' };

/** First out-of-range polling field as a message, or '' when the config is valid. */
export function snmpConfigError(t: Translate, config: ConfigValues): string {
  for (const key of Object.keys(snmpConfigBounds) as Array<keyof typeof snmpConfigBounds>) {
    const { min, max } = snmpConfigBounds[key];
    const value = config[key];
    if (!Number.isInteger(value) || value < min || value > max) return t('snmp.bounds.integerRange', undefined, { field: t(configLabels[key]), min, max });
  }
  return '';
}

type CredentialValues = { version: string; label?: string; username?: string; community?: string; authKey?: string; privKey?: string };

/** First invalid credential field as a message, or '' when the credential can be sent. */
export function snmpCredentialError(t: Translate, credential: CredentialValues): string {
  const { secret } = snmpCredentialBounds;
  if ((credential.label ?? '').length > snmpCredentialBounds.label.max) return t('snmp.bounds.labelTooLong', undefined, { max: snmpCredentialBounds.label.max });
  if (credential.version === 'V2C') {
    const community = credential.community ?? '';
    if (community.length < secret.min || community.length > secret.max) return t('snmp.bounds.communityLength', undefined, { min: secret.min, max: secret.max });
    return '';
  }
  const username = (credential.username ?? '').trim();
  if (!username || username.length > snmpCredentialBounds.username.max) return t('snmp.bounds.usernameRequired', undefined, { max: snmpCredentialBounds.username.max });
  for (const [value, key] of [[credential.authKey ?? '', 'snmp.bounds.authKeyLength'], [credential.privKey ?? '', 'snmp.bounds.privacyKeyLength']] as const) {
    if (value.length < secret.min || value.length > secret.max) return t(key, undefined, { min: secret.min, max: secret.max });
  }
  return '';
}
