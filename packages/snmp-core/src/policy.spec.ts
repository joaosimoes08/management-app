import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseEngineId, generateSnmpEngineId, LEGACY_SHARED_ENGINE_ID, normalizeEngineId, snmpV2cAllowed } from './policy';

describe('SNMP Phase 1 policy', () => {
  it('allows v2c only when the lab flag is exactly true', () => {
    assert.equal(snmpV2cAllowed(undefined), false);
    assert.equal(snmpV2cAllowed(''), false);
    assert.equal(snmpV2cAllowed('false'), false);
    assert.equal(snmpV2cAllowed('1'), false);
    assert.equal(snmpV2cAllowed('true'), true);
    assert.equal(snmpV2cAllowed(' TRUE '), true);
  });

  it('generates a unique RFC 3411 engine ID per call', () => {
    const first = generateSnmpEngineId();
    const second = generateSnmpEngineId();
    assert.match(first, /^8000b98305[0-9a-f]{24}$/);
    assert.notEqual(first, second);
    assert.equal(normalizeEngineId(first), first);
  });

  it('rejects malformed engine IDs', () => {
    for (const value of ['', 'xyz', '800', '0x8000b98', 'a'.repeat(66)]) assert.equal(normalizeEngineId(value), undefined, value);
    assert.equal(normalizeEngineId('0x8000B98305AABBCCDDEEFF001122'), '8000b98305aabbccddeeff001122');
  });

  it('never uses the old shared compose default', () => {
    const generated = () => '8000b98305000000000000000000000001';
    assert.deepEqual(chooseEngineId(LEGACY_SHARED_ENGINE_ID, null, generated), { engineId: generated(), source: 'GENERATED' });
    assert.deepEqual(chooseEngineId(LEGACY_SHARED_ENGINE_ID, LEGACY_SHARED_ENGINE_ID, generated), { engineId: generated(), source: 'GENERATED' });
    assert.deepEqual(chooseEngineId(LEGACY_SHARED_ENGINE_ID, '8000b98305aabbccddeeff001122', generated), { engineId: '8000b98305aabbccddeeff001122', source: 'STORED' });
  });

  it('prefers an explicit operator engine ID, then the stored one', () => {
    assert.deepEqual(chooseEngineId('8000b98305112233445566778899', '8000b98305aabbccddeeff001122'), { engineId: '8000b98305112233445566778899', source: 'ENV' });
    assert.deepEqual(chooseEngineId(undefined, '8000b98305aabbccddeeff001122'), { engineId: '8000b98305aabbccddeeff001122', source: 'STORED' });
    assert.equal(chooseEngineId('not-hex', null).source, 'GENERATED');
  });
});
