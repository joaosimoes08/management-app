import { strict as assert } from 'node:assert';
import { it } from 'node:test';
import { pollLldp } from './client';

it('collects LLDP identifiers using read-only subtree walks', async () => {
  const calls: string[] = [];
  const rows: Record<string, Array<{ oid: string; value: unknown }>> = {
    '1.0.8802.1.1.2.1.4.1.1': [
      { oid: '1.0.8802.1.1.2.1.4.1.1.5.0.7.2', value: Buffer.from('chassis-7') },
      { oid: '1.0.8802.1.1.2.1.4.1.1.7.0.7.2', value: Buffer.from('Gi0/1') },
      { oid: '1.0.8802.1.1.2.1.4.1.1.9.0.7.2', value: Buffer.from('switch-b') },
    ],
    '1.0.8802.1.1.2.1.3.7.1.3': [{ oid: '1.0.8802.1.1.2.1.3.7.1.3.7', value: Buffer.from('Gi1/0/1') }],
    '1.0.8802.1.1.2.1.4.2.1.4': [],
  };
  const session = { subtree(oid: string, _max: number, feed: (items: any[]) => void, done: (error?: Error) => void) { calls.push(oid); feed(rows[oid] ?? []); done(); } } as any;
  const result = await pollLldp(session);
  assert.equal(result.length, 1);
  assert.equal(result[0].localPortNumber, 7);
  assert.equal(result[0].localPortId, 'Gi1/0/1');
  assert.equal(result[0].chassisId, 'chassis-7');
  assert.equal(result[0].portId, 'Gi0/1');
  assert.equal(result[0].systemName, 'switch-b');
  assert.equal(calls.some((oid) => oid.includes('.4.1.')), true);
  assert.deepEqual(calls.filter((oid) => oid.includes('.4.2.')), ['1.0.8802.1.1.2.1.4.2.1.4']);
});
