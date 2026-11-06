import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PersistedDeviceAuditError, updateDevicesIndividually } from './bulk-update';

test('bulk updates continue after an individual failure and return every outcome', async () => {
  const attempted: string[] = [];
  const result = await updateDevicesIndividually([{ id: 'one' }, { id: 'two' }, { id: 'three' }], async ({ id }) => {
    attempted.push(id);
    if (id === 'two') throw new Error('Scope denied');
  });

  assert.deepEqual(attempted, ['one', 'two', 'three']);
  assert.deepEqual(result, { updatedIds: ['one', 'three'], failed: [{ id: 'two', message: 'Scope denied' }], auditFailed: [] });
});

test('audit failure after persistence is reported as saved with an audit warning', async () => {
  const result = await updateDevicesIndividually([{ id: 'one' }, { id: 'two' }], async ({ id }) => {
    if (id === 'one') throw new PersistedDeviceAuditError(id);
  });

  assert.deepEqual(result, {
    updatedIds: ['one', 'two'],
    failed: [],
    auditFailed: [{ id: 'one', message: 'A atualização foi guardada, mas não foi possível registar a auditoria.' }],
  });
});
