import { describe, expect, it } from 'vitest';
import type { DeviceInterface } from '@/features/infrastructure/types';
import { availableInterfaces, retainAvailableInterfaceId } from './port-availability';

const ports = [{ id: 'free' }, { id: 'occupied' }] as DeviceInterface[];

describe('topology interface availability', () => {
  it('hides ports marked used by the API', () => {
    expect(availableInterfaces(ports, new Set(['occupied'])).map((port) => port.id)).toEqual(['free']);
  });

  it('clears a selected port when a refreshed API response marks it used', () => {
    const used = new Set(['occupied']);
    expect(retainAvailableInterfaceId('occupied', used)).toBe('');
    expect(retainAvailableInterfaceId('free', used)).toBe('free');
  });
});
