import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { planRackPlacement, RackPlacementRack } from './rack-placement';

const racks = (): RackPlacementRack[] => [
  {
    id: 'rack-a', name: 'A', units: 42, devices: [
      { id: 'moving', name: 'Moving', rackId: 'rack-a', rackUnitStart: 20, rackUnitSize: 2 },
      { id: 'one-u', name: 'One', rackId: 'rack-a', rackUnitStart: 10, rackUnitSize: 1 },
    ],
  },
  {
    id: 'rack-b', name: 'B', units: 42, devices: [
      { id: 'two-u', name: 'Two', rackId: 'rack-b', rackUnitStart: 15, rackUnitSize: 2 },
    ],
  },
];

test('snaps a device into an empty rack unit', () => {
  const plan = planRackPlacement(racks(), 'moving', 'rack-a', 30);
  assert.deepEqual(plan.changes.map(({ id, rackUnitStart }) => ({ id, rackUnitStart })), [
    { id: 'moving', rackUnitStart: 30 },
  ]);
});

test('moves an overlapped device down by its own U size', () => {
  const plan = planRackPlacement(racks(), 'moving', 'rack-b', 15);
  assert.deepEqual(plan.changes.map(({ id, rackId, rackUnitStart, reason }) => ({ id, rackId, rackUnitStart, reason })), [
    { id: 'moving', rackId: 'rack-b', rackUnitStart: 15, reason: 'MOVED' },
    { id: 'two-u', rackId: 'rack-b', rackUnitStart: 13, reason: 'DISPLACED' },
  ]);
});

test('moves a one-U overlap down by one U', () => {
  const plan = planRackPlacement(racks(), 'moving', 'rack-a', 10);
  assert.deepEqual(plan.changes.map(({ id, rackUnitStart, reason }) => ({ id, rackUnitStart, reason })), [
    { id: 'moving', rackUnitStart: 10, reason: 'MOVED' },
    { id: 'one-u', rackUnitStart: 9, reason: 'DISPLACED' },
  ]);
});

test('swaps devices when the overlapped device cannot move down', () => {
  const data = racks();
  data[1].devices[0].rackUnitStart = 1;
  const plan = planRackPlacement(data, 'moving', 'rack-b', 1);
  assert.deepEqual(plan.changes.map(({ id, rackId, rackUnitStart, reason }) => ({ id, rackId, rackUnitStart, reason })), [
    { id: 'moving', rackId: 'rack-b', rackUnitStart: 1, reason: 'MOVED' },
    { id: 'two-u', rackId: 'rack-a', rackUnitStart: 20, reason: 'SWAPPED' },
  ]);
});

test('swaps devices inside the same rack when there is no space below', () => {
  const data = racks();
  data[0].devices[1].rackUnitStart = 1;
  const plan = planRackPlacement(data, 'moving', 'rack-a', 1);
  assert.deepEqual(plan.changes.map(({ id, rackId, rackUnitStart, reason }) => ({ id, rackId, rackUnitStart, reason })), [
    { id: 'moving', rackId: 'rack-a', rackUnitStart: 1, reason: 'MOVED' },
    { id: 'one-u', rackId: 'rack-a', rackUnitStart: 20, reason: 'SWAPPED' },
  ]);
});

test('clamps a drop to the rack boundaries', () => {
  const plan = planRackPlacement(racks(), 'moving', 'rack-a', 42);
  assert.equal(plan.target.rackUnitStart, 41);
});
