import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { updateDevicesIndividually } from './bulk-update';

test('bulk updates continue after an individual failure and return every outcome', async () => {
  const attempted: string[] = [];
  const result = await updateDevicesIndividually([{ id: 'one' }, { id: 'two' }, { id: 'three' }], async ({ id }) => {
    attempted.push(id);
    if (id === 'two') throw new Error('Scope denied');
  });

  assert.deepEqual(attempted, ['one', 'two', 'three']);
  assert.deepEqual(result, { updatedIds: ['one', 'three'], failed: [{ id: 'two', message: 'Scope denied' }] });
});
