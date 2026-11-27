import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { parseInfrastructureContext, readInfrastructureContext, writeInfrastructureContext } from './utils';

afterEach(() => window.localStorage.clear());

describe('stored infrastructure context', () => {
  const context = { siteId: 's1', buildingId: 'b1', roomId: 'r1' };

  it('reads a valid context unchanged', () => {
    expect(parseInfrastructureContext(JSON.stringify(context))).toEqual(context);
    writeInfrastructureContext(context);
    expect(readInfrastructureContext()).toEqual(context);
  });

  it('reads corrupt JSON, the wrong shape and a missing key as no context', () => {
    expect(parseInfrastructureContext('{not json')).toBeNull();
    expect(parseInfrastructureContext(JSON.stringify(['s1', 'b1', 'r1']))).toBeNull();
    expect(parseInfrastructureContext(JSON.stringify({ ...context, roomId: 7 }))).toBeNull();
    expect(parseInfrastructureContext(null)).toBeNull();
  });

  it('treats an old context missing building and room as none instead of half-restoring it', () => {
    window.localStorage.setItem(STORAGE_KEYS.infrastructureContext, JSON.stringify({ siteId: 's1' }));
    expect(readInfrastructureContext()).toBeNull();
    window.localStorage.setItem(STORAGE_KEYS.infrastructureContext, 'null');
    expect(readInfrastructureContext()).toBeNull();
  });
});
