import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateSubnetCapacity, forecastSubnetCapacity } from './subnet-capacity';

test('IPv4 usable capacity excludes network, broadcast and configured gateway', () => {
  const point = calculateSubnetCapacity('192.0.2.0/29', '192.0.2.1', [
    { address: '192.0.2.0', state: 'OCCUPIED' },
    { address: '192.0.2.1', state: 'OCCUPIED' },
    { address: '192.0.2.2', state: 'OCCUPIED' },
    { address: '192.0.2.7', state: 'OCCUPIED' },
  ]);
  assert.equal(point.usableCapacity, 5);
  assert.equal(point.trackedAddresses, 1);
  assert.equal(point.freeAddresses, 4);
});

test('IPv4 /31 and /32 apply point-to-point and host-route capacity policy', () => {
  assert.equal(calculateSubnetCapacity('192.0.2.0/31', null, []).usableCapacity, 2);
  assert.equal(calculateSubnetCapacity('192.0.2.0/31', '192.0.2.1', []).usableCapacity, 1);
  assert.equal(calculateSubnetCapacity('192.0.2.7/32', null, []).usableCapacity, 1);
});

test('IPv6 reports tracked records without broadcast deductions or free capacity', () => {
  const point = calculateSubnetCapacity('2001:db8::/64', '2001:db8::1', [
    { address: '2001:db8::1', state: 'OCCUPIED' },
    { address: '2001:db8::2', state: 'RESERVED' },
  ]);
  assert.equal(point.usableCapacity, null);
  assert.equal(point.trackedAddresses, 2);
  assert.equal(point.allocatedAddresses, 2);
  assert.equal(point.freeAddresses, null);
  assert.equal(forecastSubnetCapacity([point]).status, 'TRACKING_ONLY');
});

test('capacity forecast requires a sustained positive trend across at least seven days', () => {
  const points = [0, 2, 4, 6, 8].map((day, index) => ({
    ...calculateSubnetCapacity('192.0.2.0/24', null, []),
    sampledAt: new Date(Date.UTC(2026, 0, 1 + day)),
    usableCapacity: 100,
    allocatedAddresses: 10 + index * 2,
  }));
  const forecast = forecastSubnetCapacity(points);
  assert.equal(forecast.status, 'AVAILABLE');
  assert.equal(forecast.dailyGrowth, 1);
  assert.equal(forecast.daysUntilFull, 82);
  assert.equal(forecast.projectedFullAt?.toISOString(), '2026-04-01T00:00:00.000Z');
  assert.equal(forecastSubnetCapacity(points.slice(0, 2)).status, 'INSUFFICIENT_HISTORY');
});

test('capacity forecast suppresses projections when allocation is not growing', () => {
  const points = [0, 4, 8].map((day) => ({
    ...calculateSubnetCapacity('192.0.2.0/24', null, []),
    sampledAt: new Date(Date.UTC(2026, 0, 1 + day)),
    usableCapacity: 100,
    allocatedAddresses: 10,
  }));
  assert.equal(forecastSubnetCapacity(points).status, 'NO_GROWTH');
});

test('capacity forecast states when IPv4 allocation already reaches usable capacity', () => {
  const points = [0, 4, 8].map((day, index) => ({
    ...calculateSubnetCapacity('192.0.2.0/24', null, []),
    sampledAt: new Date(Date.UTC(2026, 0, 1 + day)),
    usableCapacity: 10,
    allocatedAddresses: 8 + index,
  }));
  const forecast = forecastSubnetCapacity(points);
  assert.equal(forecast.status, 'AT_CAPACITY');
  assert.equal(forecast.daysUntilFull, 0);
});
