import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { snmpPayload, validateSetTemplate } from './contracts';

describe('SNMP contracts', () => {
  it('keeps queue payloads identifier-only', () => {
    assert.deepEqual(snmpPayload('8d832270-fb4e-4d97-a95f-5f2f0c8da911'), { schemaVersion: 1, recordId: '8d832270-fb4e-4d97-a95f-5f2f0c8da911' });
  });

  it('rejects arbitrary SET operations', () => {
    assert.throws(() => validateSetTemplate({ operation: 'RAW_OID', oid: '1.2.3' }), /FORBIDDEN/);
  });
});
