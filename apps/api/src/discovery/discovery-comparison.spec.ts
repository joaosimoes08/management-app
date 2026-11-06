import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { compareDiscoveryResults } from './discovery-comparison';

test('compares only the two supplied runs and identifies added, changed and missing hosts', () => {
  const previous = [
    { address: '10.0.0.2', hostname: 'old.example', icmpReachable: true, openPorts: [443, 22] },
    { address: '10.0.0.3', hostname: null, icmpReachable: false, openPorts: [80] },
  ];
  const current = [
    { address: '10.0.0.1', hostname: null, icmpReachable: true, openPorts: [] },
    { address: '10.0.0.2', hostname: 'new.example', icmpReachable: true, openPorts: [22, 443, 8080] },
  ];
  const result = compareDiscoveryResults(previous, current);
  assert.deepEqual(result.newlySeen.map(({ address }) => address), ['10.0.0.1']);
  assert.deepEqual(result.noLongerReachable.map(({ address }) => address), ['10.0.0.3']);
  assert.deepEqual(result.changed.map(({ address, changes }) => ({ address, changes })), [{ address: '10.0.0.2', changes: ['hostname', 'openPorts'] }]);
});

test('treats open ports as a set regardless of ordering', () => {
  const result = compareDiscoveryResults(
    [{ address: '10.0.0.2', hostname: null, icmpReachable: true, openPorts: [443, 22] }],
    [{ address: '10.0.0.2', hostname: null, icmpReachable: true, openPorts: [22, 443] }],
  );
  assert.deepEqual(result.changed, []);
});
