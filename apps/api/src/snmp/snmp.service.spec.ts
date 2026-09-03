import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { SnmpService } from './snmp.service';

const service = Object.create(SnmpService.prototype) as any;

describe('SNMP credential policy and redaction', () => {
  it('requires authPriv material and gates SHA-1 compatibility', () => {
    assert.deepEqual(service.credentialSecret({ version: 'V3', username: 'operator', authKey: 'auth-key-value', privKey: 'priv-key-value' }), {
      username: 'operator', authKey: 'auth-key-value', privKey: 'priv-key-value',
    });
    assert.throws(() => service.credentialSecret({ version: 'V3', username: 'operator', authKey: 'auth-key-value', privKey: 'priv-key-value', authProtocol: 'SHA1' }, { compatibilitySha1: false }));
    assert.doesNotThrow(() => service.credentialSecret({ version: 'V3', username: 'operator', authKey: 'auth-key-value', privKey: 'priv-key-value', authProtocol: 'SHA1' }, { compatibilitySha1: true }));
    assert.throws(() => service.credentialSecret({ version: 'V3', username: 'operator', authKey: 'short', privKey: 'short' }));
  });

  it('never exposes encrypted payload fields in API summaries', () => {
    const output = service.publicCredential({
      id: 'credential-id', deviceId: 'device-id', purpose: 'READ', version: 'V3', username: 'operator',
      ciphertext: Buffer.from('ciphertext'), iv: Buffer.from('iv'), authTag: Buffer.from('tag'),
      wrappedDek: Buffer.from('dek'), wrapIv: Buffer.from('iv'), wrapAuthTag: Buffer.from('tag'),
      keyId: 'v1', enabled: true,
    });
    assert.equal(output.configured, true);
    for (const field of ['ciphertext', 'iv', 'authTag', 'wrappedDek', 'wrapIv', 'wrapAuthTag']) assert.equal(field in output, false);
  });

  it('redacts enrollment envelopes and selects the most specific Site subnet', () => {
    const output = service.publicEnrollment({
      id: 'enrollment-id', siteId: 'site-id', sourceAddress: '10.20.30.42', status: 'DISCOVERED',
      ciphertext: Buffer.from('ciphertext'), iv: Buffer.from('iv'), authTag: Buffer.from('tag'),
      wrappedDek: Buffer.from('dek'), wrapIv: Buffer.from('iv'), wrapAuthTag: Buffer.from('tag'), keyId: 'v1',
    });
    for (const field of ['ciphertext', 'iv', 'authTag', 'wrappedDek', 'wrapIv', 'wrapAuthTag']) assert.equal(field in output, false);
    assert.equal(service.mostSpecificSubnet('10.20.30.42', [
      { id: 'broad', cidr: '10.0.0.0/8' },
      { id: 'site', cidr: '10.20.30.0/24' },
      { id: 'specific', cidr: '10.20.30.32/28' },
      { id: 'other', cidr: '10.20.31.0/24' },
    ]).id, 'specific');
    assert.equal(service.mostSpecificSubnet('192.0.2.1', [{ id: 'site', cidr: '10.20.30.0/24' }]), undefined);
  });
});
