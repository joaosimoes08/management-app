import { describe, expect, it } from 'vitest';
import type { AuditEvent } from './api';
import { filterAuditEvents } from './search';

const events: AuditEvent[] = [
  {
    id: 'authenticated-event',
    action: 'AUTHENTI\u200bCATED',
    entityType: 'Session',
    createdAt: '2026-11-03T10:00:00.000Z',
  },
  {
    id: 'other-event',
    action: 'USER_UPDATED',
    entityType: 'User',
    createdAt: '2026-11-03T09:00:00.000Z',
  },
];

describe('filterAuditEvents', () => {
  it('keeps visible AUTHENTICATED events when their action contains an invisible format character', () => {
    expect(filterAuditEvents(events, 'AUTHENTICATED').map((event) => event.id))
      .toEqual(['authenticated-event']);
  });

  it('ignores surrounding whitespace and matches without case sensitivity', () => {
    expect(filterAuditEvents(events, '  authenticated  ').map((event) => event.id))
      .toEqual(['authenticated-event']);
  });

  it('returns all events for an empty search', () => {
    expect(filterAuditEvents(events, ' ')).toEqual(events);
  });
});
