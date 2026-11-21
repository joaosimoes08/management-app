import type { ReactNode } from 'react';

export type HistoryEvent = {
  id: string;
  /** First line, e.g. "Semana de 16/11/2026" or an action name. */
  title: ReactNode;
  /** Status shown before the date, usually a `state-badge`. */
  status?: ReactNode;
  /** ISO timestamp of the event. */
  at?: string | null;
  actor?: string | null;
  note?: string | null;
  /** Buttons for this event (shown on the right). */
  actions?: ReactNode;
};

export type HistoryBlockProps = {
  heading: ReactNode;
  events: readonly HistoryEvent[];
  /**
   * Formats `at`. Required on purpose: pages pass their current formatter until
   * the shared date formatter (Phase B step 3) lands.
   */
  formatDate: (value: string) => string;
  empty: ReactNode;
  noteLabel?: string;
  headingLevel?: 'h2' | 'h3' | 'h4';
};

/** "Histórico": dated events with actor and note, in the side-panel style (`host-section` / `host-relation`). */
export function HistoryBlock({ heading, events, formatDate, empty, noteLabel = 'Notas', headingLevel: Heading = 'h3' }: HistoryBlockProps) {
  return <section className="host-section">
    <Heading>{heading}</Heading>
    {events.map((event) => <article className="host-relation" key={event.id}>
      <div>
        <strong>{event.title}</strong>
        {(event.status || event.at || event.actor) && <span>
          {event.status}
          {(event.at || event.actor) && <span>
            {' · '}
            {event.at && <time dateTime={event.at}>{formatDate(event.at)}</time>}
            {event.at && event.actor && ' · '}
            {event.actor}
          </span>}
        </span>}
        {event.note && <small>{noteLabel}: {event.note}</small>}
      </div>
      {event.actions}
    </article>)}
    {!events.length && <p className="panel-description">{empty}</p>}
  </section>;
}
