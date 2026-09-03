import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decryptCredential, encryptCredential, parseKeyring, redactSecrets, resolveKeyringPath, rewrapCredential } from './crypto';

const key = (byte: number) => Buffer.alloc(32, byte).toString('base64');

describe('SNMP credential envelope', () => {
  it('encrypts, decrypts and rewraps without exposing plaintext', () => {
    const first = parseKeyring(JSON.stringify({ activeKeyId: 'v1', keys: { v1: key(1), v2: key(2) } }));
    const envelope = encryptCredential({ community: 'private-value' }, first);
    assert.equal(Buffer.from(envelope.ciphertext).includes(Buffer.from('private-value')), false);
    assert.deepEqual(decryptCredential(envelope, first), { community: 'private-value' });
    const second = parseKeyring(JSON.stringify({ activeKeyId: 'v2', keys: { v1: key(1), v2: key(2) } }));
    const rotated = rewrapCredential(envelope, second);
    assert.equal(rotated.keyId, 'v2');
    assert.deepEqual(decryptCredential(rotated, second), { community: 'private-value' });
  });

  it('redacts nested secrets', () => {
    assert.deepEqual(redactSecrets({ username: 'safe', authKey: 'secret', nested: { community: 'secret' } }), { username: 'safe', authKey: '[REDACTED]', nested: { community: '[REDACTED]' } });
  });

  it('resolves a relative keyring from the npm invocation directory', () => {
    assert.equal(resolveKeyringPath('./secrets/snmp-keyring.json', '/srv/mgmt-app'), '/srv/mgmt-app/secrets/snmp-keyring.json');
    assert.equal(resolveKeyringPath('/run/secrets/snmp_keyring', '/srv/mgmt-app'), '/run/secrets/snmp_keyring');
  });
});
