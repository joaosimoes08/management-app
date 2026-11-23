import { randomBytes } from 'node:crypto';

/**
 * SNMP plan step 1.3 (revision 4): SNMPv2c and SNMPv3 are both accepted; v3 authPriv stays the recommended option
 * and SNMPv1 is always refused. SNMP_ALLOW_V2C is an opt-out: only the value `false` refuses v2c (save, poll and
 * trap authentication). Unset, empty or anything else means v2c is allowed.
 */
export function snmpV2cAllowed(value: string | undefined = process.env.SNMP_ALLOW_V2C) {
  return value?.trim().toLowerCase() !== 'false';
}

export const SNMP_V2C_DISABLED = 'SNMP_V2C_DISABLED';

/** The engine ID every install shipped with in docker-compose.yml / .env.example before Phase 1. Never used as-is. */
export const LEGACY_SHARED_ENGINE_ID = '8000b983800102030405060708090a0b';

/** RFC 3411 SnmpEngineID: 0x80 + enterprise 47491 (0x0000B983), format 0x05 (octets), then 12 random bytes. Hex, 17 bytes. */
export function generateSnmpEngineId(random: (size: number) => Buffer = randomBytes) {
  return `8000b98305${random(12).toString('hex')}`;
}

export function normalizeEngineId(value: string | null | undefined) {
  const hex = (value ?? '').trim().toLowerCase().replace(/^0x/, '');
  // RFC 3411: 5 to 32 octets.
  return /^[0-9a-f]+$/.test(hex) && hex.length % 2 === 0 && hex.length >= 10 && hex.length <= 64 ? hex : undefined;
}

export type EngineIdChoice = { engineId: string; source: 'ENV' | 'STORED' | 'GENERATED' };

/**
 * Which engine ID the trap receiver uses. An explicit SNMP_ENGINE_ID wins, unless it is the old shared default
 * (then it is ignored); otherwise the one stored for this install; otherwise a new one that the caller must store.
 */
export function chooseEngineId(envValue: string | undefined, stored: string | null | undefined, generate = generateSnmpEngineId): EngineIdChoice {
  const env = normalizeEngineId(envValue);
  if (env && env !== LEGACY_SHARED_ENGINE_ID) return { engineId: env, source: 'ENV' };
  const saved = normalizeEngineId(stored);
  if (saved && saved !== LEGACY_SHARED_ENGINE_ID) return { engineId: saved, source: 'STORED' };
  return { engineId: generate(), source: 'GENERATED' };
}
