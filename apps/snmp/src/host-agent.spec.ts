import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderComposeOverride, selectedHostAddresses } from './host-agent';

const interfaces = [
  { instanceId: 'host:test', name: 'en0', address: '192.168.151.203', internal: false },
  { instanceId: 'host:test', name: 'lo0', address: '127.0.0.1', internal: true },
];

test('host listener selection only accepts an exact current interface', () => {
  assert.deepEqual(selectedHostAddresses({ listenAll: false, selectedInterfaces: [
    { instanceId: 'host:test', name: 'en0', address: '192.168.151.203' },
    { instanceId: 'host:other', name: 'en0', address: '10.0.0.5' },
  ] }, interfaces), ['192.168.151.203']);
  assert.deepEqual(selectedHostAddresses({ listenAll: true, selectedInterfaces: [] }, interfaces), ['0.0.0.0']);
});

test('compose override binds UDP 162 only to validated host addresses', () => {
  const output = renderComposeOverride(['192.168.151.203'], 162);
  assert.match(output, /target: 1162/);
  assert.match(output, /published: "162"/);
  assert.match(output, /protocol: udp/);
  assert.match(output, /host_ip: "192\.168\.151\.203"/);
  assert.doesNotMatch(output, /community|authKey|privKey/);
});

test('compose override supports multiple bindings and a fail-closed empty binding', () => {
  const multiple = renderComposeOverride(['10.0.0.5', '192.168.151.203'], 1162);
  assert.equal((multiple.match(/target: 1162/g) ?? []).length, 2);
  assert.match(multiple, /host_ip: "10\.0\.0\.5"/);
  assert.match(multiple, /host_ip: "192\.168\.151\.203"/);
  assert.match(renderComposeOverride([], 162), /ports:\n      \[\]/);
});
