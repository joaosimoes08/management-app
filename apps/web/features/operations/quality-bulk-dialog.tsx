'use client';

import { useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { CompactModal } from '@/components/ui/compact-modal';
import { DataTable } from '@/components/data-table/data-table';
import { formatDateTime } from '@/lib/format/date';
import type { BulkFindingAction, FindingPerson } from './api';
import { DEFAULT_SNOOZE_HOURS, personName, snoozeOptionLabel, snoozeOptions, type BulkOutcome } from './quality-workspace';
import { useUiText } from '@/components/ui/use-ui-text';
import { localizeServerText } from '@/lib/i18n/server-text';


export type BulkParams = { userId?: string | null; durationHours?: number };

/**
 * Bulk assign / snooze: picks the assignee or snooze length, runs, then shows
 * the per-item result. Acknowledge skips the form (the page confirms it with
 * useConfirm) and opens straight on the results.
 */
export function QualityBulkDialog({ action, count, finding, assignees, running, outcome, close, run }: {
  action: BulkFindingAction;
  count: number;
  /** Title of the one finding when opened from its row; omitted for the selection. */
  finding?: string;
  assignees: readonly FindingPerson[];
  running: boolean;
  outcome: BulkOutcome | null;
  close: () => void;
  run: (params: BulkParams) => void;
}) {
  const tx = useUiText();
  const [userId, setUserId] = useState('');
  const [hours, setHours] = useState(DEFAULT_SNOOZE_HOURS);
  const done = outcome !== null && !running;
  const allOk = outcome !== null && outcome.failed === 0;
  const selectionDescription = tx('operations.quality.bulk.selection', undefined, { count });

  return <CompactModal title={finding ? tx(`operations.quality.bulk.singleTitle.${action}`) : tx(`operations.quality.bulk.title.${action}`)} close={running ? () => undefined : close}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); run(action === 'ASSIGN' ? { userId: userId || null } : action === 'SNOOZE' ? { durationHours: hours } : {}); }}>
    {!outcome && <>
      <p className="panel-description">{finding ? tx('operations.quality.bulk.findingNamed', undefined, { title: finding }) : selectionDescription}</p>
      {action === 'ASSIGN' && <label>{tx('operations.quality.assignee')}<select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">{tx('operations.quality.unassigned')}</option>{assignees.map((person) => <option key={person.id} value={person.id}>{personName(person)}</option>)}</select></label>}
      {action === 'SNOOZE' && <label>{tx('operations.quality.bulk.snoozeFor')}<select value={hours} onChange={(event) => setHours(Number(event.target.value))}>{snoozeOptions.map((option) => <option key={option.hours} value={option.hours}>{snoozeOptionLabel(option, tx)}</option>)}</select></label>}
    </>}
    {done && <div className={`ipam-alert ${allOk ? 'success' : 'error'}`} role="status">{allOk ? <CheckCircle2 size={15} /> : <X size={15} />}{tx('groupB.quality.applied', undefined, { succeeded: outcome.succeeded, total: outcome.items.length })}{outcome.snoozedUntil ? ` ${tx('groupB.quality.snoozedUntil', undefined, { date: formatDateTime(outcome.snoozedUntil, { dateStyle: 'short', timeStyle: 'short' }) })}` : ''}</div>}
    {outcome && <div className="quality-bulk-results"><DataTable rows={outcome.items} rowKey={(item) => item.id} label={tx('operations.quality.bulk.results')} columns={[
      { id: 'finding', header: tx('operations.quality.finding'), cell: (item) => localizeServerText(tx, item.title) },
      { id: 'result', header: tx('operations.quality.bulk.result'), cell: (item) => <span className={`state-badge ${item.ok ? 'occupied' : 'excluded'}`}><i />{localizeServerText(tx, item.message)}</span> },
    ]} /></div>}
    <div className="modal-actions">{outcome
      ? <button type="button" className="primary-button" disabled={running} onClick={close}>{tx('operations.quality.bulk.close')}</button>
      : <><button type="button" className="secondary-button" disabled={running} onClick={close}>{tx('operations.config.cancel')}</button><button type="submit" className="primary-button" disabled={running || !count}>{running ? tx('operations.quality.bulk.applying') : finding ? tx(`operations.quality.bulk.run.${action}`) : tx(`operations.quality.bulk.runCount.${action}`, undefined, { count })}</button></>}</div>
  </form></CompactModal>;
}
