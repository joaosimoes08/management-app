'use client';

import { useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { IpamModal } from '@/features/ipam/components/ipam-modal';
import { formatDateTime } from '@/lib/format/date';
import type { BulkFindingAction, FindingPerson } from './api';
import { DEFAULT_SNOOZE_HOURS, personName, snoozeOptions, type BulkOutcome } from './quality-workspace';

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
  const [userId, setUserId] = useState('');
  const [hours, setHours] = useState(DEFAULT_SNOOZE_HOURS);
  const done = outcome !== null && !running;
  const allOk = outcome !== null && outcome.failed === 0;
  const selectionDescription = count === 1
    ? '1 finding selecionado.'
    : `${count} findings selecionados. Cada finding é verificado à parte; uma falha não impede os restantes.`;

  return <IpamModal title={finding ? singleTitles[action] : titles[action]} close={running ? () => undefined : close}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); run(action === 'ASSIGN' ? { userId: userId || null } : action === 'SNOOZE' ? { durationHours: hours } : {}); }}>
    {!outcome && <>
      <p className="panel-description">{finding ? `Finding: ${finding}` : selectionDescription}</p>
      {action === 'ASSIGN' && <label>Responsável<select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Sem responsável</option>{assignees.map((person) => <option key={person.id} value={person.id}>{personName(person)}</option>)}</select></label>}
      {action === 'SNOOZE' && <label>Adiar durante<select value={hours} onChange={(event) => setHours(Number(event.target.value))}>{snoozeOptions.map((option) => <option key={option.hours} value={option.hours}>{option.label}</option>)}</select></label>}
    </>}
    {done && <div className={`ipam-alert ${allOk ? 'success' : 'error'}`} role="status">{allOk ? <CheckCircle2 size={15} /> : <X size={15} />}{`${outcome.succeeded} de ${outcome.items.length} aplicados.`}{outcome.snoozedUntil ? ` ${`Adiados até ${formatDateTime(outcome.snoozedUntil, { dateStyle: 'short', timeStyle: 'short' })}.`}` : ''}</div>}
    {outcome && <div className="ip-table-wrap quality-bulk-results" role="region" aria-label="Resultado por finding" tabIndex={0}><table className="ip-table">
      <thead><tr><th scope="col">Finding</th><th scope="col">Resultado</th></tr></thead>
      <tbody>{outcome.items.map((item) => <tr key={item.id}><td>{item.title}</td><td><span className={`state-badge ${item.ok ? 'occupied' : 'excluded'}`}><i />{item.message}</span></td></tr>)}</tbody>
    </table></div>}
    <div className="modal-actions">{outcome
      ? <button type="button" className="primary-button" disabled={running} onClick={close}>Fechar</button>
      : <><button type="button" className="secondary-button" disabled={running} onClick={close}>Cancelar</button><button type="submit" className="primary-button" disabled={running || !count}>{running ? 'A aplicar…' : finding ? (action === 'ASSIGN' ? 'Atribuir' : action === 'SNOOZE' ? 'Adiar' : 'Reconhecer') : action === 'ASSIGN' ? `Atribuir ${count}` : action === 'SNOOZE' ? `Adiar ${count}` : `Reconhecer ${count}`}</button></>}</div>
  </form></IpamModal>;
}
