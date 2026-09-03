import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const ALGORITHM = 'aes-256-gcm';

type CryptoBytes = Uint8Array<ArrayBuffer>;
export type SnmpKeyring = { activeKeyId: string; keys: Record<string, CryptoBytes> };
export type SnmpEnvelope = {
  ciphertext: CryptoBytes;
  iv: CryptoBytes;
  authTag: CryptoBytes;
  wrappedDek: CryptoBytes;
  wrapIv: CryptoBytes;
  wrapAuthTag: CryptoBytes;
  keyId: string;
};

function decodeKey(value: string) {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('SNMP_KEYRING_KEY_INVALID');
  return Uint8Array.from(key);
}

export function parseKeyring(input: string): SnmpKeyring {
  let parsed: unknown;
  try { parsed = JSON.parse(input); } catch { throw new Error('SNMP_KEYRING_INVALID'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('SNMP_KEYRING_INVALID');
  const value = parsed as { activeKeyId?: unknown; keys?: unknown };
  if (typeof value.activeKeyId !== 'string' || !value.keys || typeof value.keys !== 'object') throw new Error('SNMP_KEYRING_INVALID');
  const keys = Object.fromEntries(Object.entries(value.keys as Record<string, unknown>).map(([id, key]) => {
    if (typeof key !== 'string') throw new Error('SNMP_KEYRING_INVALID');
    return [id, decodeKey(key)];
  }));
  if (!keys[value.activeKeyId]) throw new Error('SNMP_KEYRING_ACTIVE_KEY_MISSING');
  return { activeKeyId: value.activeKeyId, keys };
}

export function resolveKeyringPath(path: string, baseDirectory = process.env.INIT_CWD?.trim() || process.cwd()) {
  return isAbsolute(path) ? path : resolve(baseDirectory, path);
}

export function loadKeyring(path = process.env.SNMP_KEYRING_FILE) {
  if (!path) throw new Error('SNMP_KEYRING_FILE_REQUIRED');
  return parseKeyring(readFileSync(resolveKeyringPath(path), 'utf8'));
}

function encryptWithKey(plaintext: Uint8Array, key: Uint8Array) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext: Uint8Array.from(ciphertext), iv: Uint8Array.from(iv), authTag: Uint8Array.from(cipher.getAuthTag()) };
}

function decryptWithKey(ciphertext: Uint8Array, iv: Uint8Array, authTag: Uint8Array, key: Uint8Array) {
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Uint8Array.from(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

export function encryptCredential(secret: Record<string, string>, keyring: SnmpKeyring): SnmpEnvelope {
  const dek = Uint8Array.from(randomBytes(32));
  const payload = encryptWithKey(Buffer.from(JSON.stringify(secret), 'utf8'), dek);
  const wrapped = encryptWithKey(dek, keyring.keys[keyring.activeKeyId]);
  dek.fill(0);
  return { ...payload, wrappedDek: wrapped.ciphertext, wrapIv: wrapped.iv, wrapAuthTag: wrapped.authTag, keyId: keyring.activeKeyId };
}

export function decryptCredential(envelope: SnmpEnvelope, keyring: SnmpKeyring): Record<string, string> {
  const kek = keyring.keys[envelope.keyId];
  if (!kek) throw new Error('SNMP_KEYRING_KEY_MISSING');
  const dek = decryptWithKey(envelope.wrappedDek, envelope.wrapIv, envelope.wrapAuthTag, kek);
  try {
    return JSON.parse(Buffer.from(decryptWithKey(envelope.ciphertext, envelope.iv, envelope.authTag, dek)).toString('utf8')) as Record<string, string>;
  } finally {
    dek.fill(0);
  }
}

export function rewrapCredential(envelope: SnmpEnvelope, keyring: SnmpKeyring): SnmpEnvelope {
  if (envelope.keyId === keyring.activeKeyId) return envelope;
  const oldKey = keyring.keys[envelope.keyId];
  if (!oldKey) throw new Error('SNMP_KEYRING_KEY_MISSING');
  const dek = decryptWithKey(envelope.wrappedDek, envelope.wrapIv, envelope.wrapAuthTag, oldKey);
  try {
    const wrapped = encryptWithKey(dek, keyring.keys[keyring.activeKeyId]);
    return { ...envelope, wrappedDek: wrapped.ciphertext, wrapIv: wrapped.iv, wrapAuthTag: wrapped.authTag, keyId: keyring.activeKeyId };
  } finally {
    dek.fill(0);
  }
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  const secretKeys = /community|authkey|privkey|password|secret|ciphertext|wrappeddek/i;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, secretKeys.test(key) ? '[REDACTED]' : redactSecrets(item)]));
}
