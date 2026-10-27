export type OperationEvent<T = unknown> = { event: string; data: T; id?: string };

export function pubSubAvailability(event: OperationEvent): boolean | undefined {
  if (event.event !== 'heartbeat' || typeof event.data !== 'object' || event.data === null || !('pubSubAvailable' in event.data)) return undefined;
  return typeof (event.data as { pubSubAvailable?: unknown }).pubSubAvailable === 'boolean'
    ? (event.data as { pubSubAvailable: boolean }).pubSubAvailable
    : undefined;
}

/** Parse one or more SSE records. Handles comments, multiline data and a final unterminated record. */
export function parseSseChunk(chunk: string): OperationEvent[] {
  return chunk.split(/\r?\n\r?\n/).flatMap((record) => {
    if (!record.trim() || record.split(/\r?\n/).every((line) => line.startsWith(':'))) return [];
    let event = 'message'; let id: string | undefined; const data: string[] = [];
    for (const line of record.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      const separator = line.indexOf(':'); const field = separator < 0 ? line : line.slice(0, separator); const value = (separator < 0 ? '' : line.slice(separator + 1)).replace(/^ /, '');
      if (field === 'event') event = value || 'message'; else if (field === 'id') id = value; else if (field === 'data') data.push(value);
    }
    if (!data.length) return [];
    const raw = data.join('\n'); let parsed: unknown = raw; try { parsed = JSON.parse(raw); } catch { /* plain text SSE */ }
    return [{ event, data: parsed, ...(id ? { id } : {}) }];
  });
}
