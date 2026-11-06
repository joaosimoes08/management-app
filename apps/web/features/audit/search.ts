import type { AuditEvent } from './api';

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .toLowerCase();
}

export function filterAuditEvents(events: AuditEvent[], search: string): AuditEvent[] {
  const query = normalizeSearchText(search.trim());
  if (!query) return events;

  return events.filter((event) => {
    const searchableText = [
      event.action,
      event.entityType,
      event.entityId,
      event.user?.displayName,
      event.user?.username,
    ].filter(Boolean).join(' ');

    return normalizeSearchText(searchableText).includes(query);
  });
}
