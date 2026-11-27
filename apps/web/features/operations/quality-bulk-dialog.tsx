'use client';

import { useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { CompactModal } from '@/components/ui/compact-modal';
import { DataTable } from '@/components/data-table/data-table';
import { formatDateTime } from '@/lib/format/date';
import type { BulkFindingAction, FindingPerson } from './api';
import { DEFAULT_SNOOZE_HOURS, personName, snoozeOptions, type BulkOutcome } from './quality-workspace';
import { useUiText } from '@/components/ui/use-ui-text';

const titles: Record<BulkFindingAction, string> = { ACKNOWLEDGE: 'Reconhecer selecionados', ASSIGN: 'Atribuir selecionados', SNOOZE: 'Adiar selecionados' };
const singleTitles: Record<BulkFindingAction, string> = { ACKNOWLEDGE: 'Reconhecer finding', ASSIGN: 'Atribuir finding', SNOOZE: 'Adiar finding' };

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
  const selectionDescription = count === 1
    ? '1 finding selecionado.'
    : `${count} findings selecionados. Cada finding é verificado à parte; uma falha não impede os restantes.`;

  return <CompactModal title={finding ? singleTitles[action] : titles[action]} close={running ? () => undefined : close}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); run(action === 'ASSIGN' ? { userId: userId || null } : action === 'SNOOZE' ? { durationHours: hours } : {}); }}>
    {!outcome && <>
      <p className="panel-description">{finding ? `Finding: ${finding}` : selectionDescription}</p>
      {action === 'ASSIGN' && <label>Responsável<select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Sem responsável</option>{assignees.map((person) => <option key={person.id} value={person.id}>{personName(person)}</option>)}</select></label>}
      {action === 'SNOOZE' && <label>Adiar durante<select value={hours} onChange={(event) => setHours(Number(event.target.value))}>{snoozeOptions.map((option) => <option key={option.hours} value={option.hours}>{option.label}</option>)}</select></label>}
    </>}
    {done && <div className={`ipam-alert ${allOk ? 'success' : 'error'}`} role="status">{allOk ? <CheckCircle2 size={15} /> : <X size={15} />}{tx('groupB.quality.applied', undefined, { succeeded: outcome.succeeded, total: outcome.items.length })}{outcome.snoozedUntil ? ` ${tx('groupB.quality.snoozedUntil', undefined, { date: formatDateTime(outcome.snoozedUntil, { dateStyle: 'short', timeStyle: 'short' }) })}` : ''}</div>}
    {outcome && <div className="quality-bulk-results"><DataTable rows={outcome.items} rowKey={(item) => item.id} label="Resultado por finding" columns={[
      { id: 'finding', header: 'Finding', cell: (item) => item.title },
      { id: 'result', header: 'Resultado', cell: (item) => <span className={`state-badge ${item.ok ? 'occupied' : 'excluded'}`}><i />{item.message}</span> },
    ]} /></div>}
    <div className="modal-actions">{outcome
      ? <button type="button" className="primary-button" disabled={running} onClick={close}>Fechar</button>
      : <><button type="button" className="secondary-button" disabled={running} onClick={close}>Cancelar</button><button type="submit" className="primary-button" disabled={running || !count}>{running ? 'A aplicar…' : finding ? (action === 'ASSIGN' ? 'Atribuir' : action === 'SNOOZE' ? 'Adiar' : 'Reconhecer') : action === 'ASSIGN' ? `Atribuir ${count}` : action === 'SNOOZE' ? `Adiar ${count}` : `Reconhecer ${count}`}</button></>}</div>
  </form></CompactModal>;
}
