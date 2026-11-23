import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { snmpEngineIdView } from './settings.service';

test('the listener settings report the engine ID the receiver recorded, not the API env', () => {
  const previous = process.env.SNMP_ENGINE_ID;
  process.env.SNMP_ENGINE_ID = '8000b98305ffffffffffffffffff';
  try {
    assert.deepEqual(snmpEngineIdView('8000B98305AABBCCDDEEFF001122', 'STORED'), { engineId: '8000b98305aabbccddeeff001122', engineIdSource: 'STORED' });
    assert.deepEqual(snmpEngineIdView('8000b98305112233445566778899', 'ENV'), { engineId: '8000b98305112233445566778899', engineIdSource: 'ENV' });
    assert.deepEqual(snmpEngineIdView(null, null), { engineId: null, engineIdSource: null }, 'receiver never started: null, even with an API env value');
    assert.deepEqual(snmpEngineIdView('not-hex', 'ENV'), { engineId: null, engineIdSource: null });
  } finally {
    if (previous === undefined) delete process.env.SNMP_ENGINE_ID; else process.env.SNMP_ENGINE_ID = previous;
  }
});
