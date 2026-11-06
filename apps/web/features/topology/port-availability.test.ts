import { describe, expect, it } from 'vitest';
import type { DeviceInterface } from '@/features/infrastructure/types';
import { availableInterfaces, retainAvailableInterfaceId } from './port-availability';

const ports = [{ id: 'free' }, { id: 'occupied' }] as DeviceInterface[];

describe('topology interface availability', () => {
  it('hides ports marked used by the API', () => {
    expect(availableInterfaces(ports, new Set(['occupied'])).map((port) => port.id)).toEqual(['free']);
  });

  it('clears a selected port when a refreshed API response marks it used', () => {
    const selectedPortId = 'newly-connected';
    const usedBeforeCreate = new Set<string>();
    expect(retainAvailableInterfaceId(selectedPortId, usedBeforeCreate)).toBe(selectedPortId);

    // The successful create refetch returns the new connection's occupied interface IDs.
    const usedAfterCreate = new Set(['newly-connected']);
    expect(availableInterfaces([{ id: selectedPortId }] as DeviceInterface[], usedAfterCreate)).toEqual([]);
    expect(retainAvailableInterfaceId(selectedPortId, usedAfterCreate)).toBe('');
    expect(retainAvailableInterfaceId('still-free', usedAfterCreate)).toBe('still-free');
  });
});
