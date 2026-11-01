import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeOntapSnapshot, OntapClient } from './ontap-client';

test('normalizes cluster storage, capacity, and component health', () => {
  const snapshot = normalizeOntapSnapshot({
    cluster: [{ name: 'prod-a', uuid: 'cluster-1', version: { full: '9.15.1' } }],
    nodes: [{ name: 'node-1', health: true }],
    aggregates: [{ name: 'aggr1', state: 'online', space: { block_storage: { size: 1000, used: 600 } } }],
    volumes: [{ name: 'vol1', state: 'online', svm: { name: 'svm1' }, space: { size: 500, used: 250 } }],
  });
  assert.equal(snapshot.systems[0].version, '9.15.1');
  assert.equal(snapshot.capacity.usedPercent, 60);
  assert.equal(snapshot.capacity.availableBytes, 400);
  assert.equal(snapshot.volumes[0].svm, 'svm1');
  assert.equal(snapshot.health, 'healthy');
});

test('blocks cross-origin pagination and redirects before following credentials', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ records: [{ name: 'first' }], _links: { next: { href: 'https://attacker.example/api/storage/volumes' } } }), { status: 200 });
  };
  const client = new OntapClient('https://ontap.example', 'reader', 'secret', 500, fetcher);
  await assert.rejects(() => (client as any).getCollection('storage/volumes'), /ONTAP_PAGINATION_ORIGIN_INVALID/);
  assert.equal(calls, 1);
});

test('blocks redirects from an ONTAP origin', async () => {
  const fetcher: typeof fetch = async () => new Response(null, { status: 302, headers: { location: 'https://attacker.example' } });
  const client = new OntapClient('https://ontap.example', 'reader', 'secret', 500, fetcher);
  await assert.rejects(() => (client as any).getCollection('storage/volumes'), /ONTAP_REDIRECT_BLOCKED/);
});
