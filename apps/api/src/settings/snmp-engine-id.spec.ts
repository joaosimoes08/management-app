import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { LEGACY_SHARED_ENGINE_ID } from '@simoes/snmp-core';
import { snmpEngineIdView } from './settings.service';

test('the listener settings expose the engine ID the trap receiver uses', () => {
  assert.deepEqual(snmpEngineIdView(undefined, '8000B98305AABBCCDDEEFF001122'), { engineId: '8000b98305aabbccddeeff001122', engineIdSource: 'STORED' });
  assert.deepEqual(snmpEngineIdView('8000b98305112233445566778899', '8000b98305aabbccddeeff001122'), { engineId: '8000b98305112233445566778899', engineIdSource: 'ENV' });
  assert.deepEqual(snmpEngineIdView(LEGACY_SHARED_ENGINE_ID, '8000b98305aabbccddeeff001122'), { engineId: '8000b98305aabbccddeeff001122', engineIdSource: 'STORED' });
  assert.deepEqual(snmpEngineIdView('not-hex', null), { engineId: null, engineIdSource: null });
  assert.deepEqual(snmpEngineIdView(undefined, LEGACY_SHARED_ENGINE_ID), { engineId: null, engineIdSource: null });
});
