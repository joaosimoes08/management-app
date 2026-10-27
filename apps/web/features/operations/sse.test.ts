import { describe, expect, it } from 'vitest';
import { parseSseChunk, pubSubAvailability } from './sse';

describe('parseSseChunk', () => {
  it('parses JSON, event names, ids and multiline data', () => {
    expect(parseSseChunk('id: 7\nevent: alert\ndata: {"id":"a"\ndata: and-more\n\n')).toEqual([{ id: '7', event: 'alert', data: '{"id":"a"\nand-more' }]);
  });
  it('ignores comments and supports plain text', () => {
    expect(parseSseChunk(': heartbeat\ndata: ready\n\n')).toEqual([{ event: 'message', data: 'ready' }]);
  });
});

describe('pubSubAvailability', () => {
  it('signals polling during Redis outages and streaming after recovery', () => {
    expect(pubSubAvailability({ event: 'heartbeat', data: { pubSubAvailable: false } })).toBe(false);
    expect(pubSubAvailability({ event: 'heartbeat', data: { pubSubAvailable: true } })).toBe(true);
    expect(pubSubAvailability({ event: 'alert', data: { pubSubAvailable: false } })).toBeUndefined();
  });
});
