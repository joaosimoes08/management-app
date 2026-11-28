'use client';

import { useEffect, useState } from 'react';
import { EntityLink } from '@/components/data-table';
import type { ConfirmFn } from '@/components/ui/confirm-dialog';
import { formatDateTime } from '@/lib/format/date';
import { addChecklistItems, closeChangePlan, getChangeConflicts, getPostChangeCheck, removeChecklistItem, startChangePlan, tickChecklistItem, type ChangeConflicts, type ChangeEntityType, type ChangePlan, type ChecklistItem, type CloseStatus, type ConflictWarning, type PostChangeCheck } from './api';
import { checkText, closeText, statusText, typeText, useChangeT, warningText } from './i18n';
import { checklistEditable, checklistProgress, checkTone, checkValue, closedStatuses, closeStatuses, closingNoteRequired, conflictRelevant, parseChecklistLines, personName } from './workspace';

const dateTime = (value: string) => formatDateTime(value, { dateStyle: 'medium', timeStyle: 'short' });
const message = (cause: unknown, fallback: string) => (cause instanceof Error && cause.message ? cause.message : fallback);
const who = (person: ChangePlan['startedBy'], at?: string | null) => [personName(person), at ? dateTime(at) : ''].filter(Boolean).join(' · ') || '—';

export type ChangeExecutionProps = {
  plan: ChangePlan;
  /** ADMIN / NETWORK_OPERATOR / SYSTEMS_OPERATOR: may start, tick, close and edit steps. */
  canAct: boolean;
  confirm: ConfirmFn;
  /** Label for a target, as the rest of the detail shows it. */
  targetLabel: (item: { entityType: ChangeEntityType; entityId: string }) => string;
  /** The plan moved on (started, closed, steps changed): refresh the detail and the list. */
  onPlanChanged: (plan: ChangePlan | null, notice: string) => void | Promise<void>;
  onOpenPlan: (plan: { id: string }) => void;
};

/** Non-blocking warnings for the plan's window and targets (`GET /change-plans/:id/conflicts`). */
function ConflictWarnings({ warnings, tierSource, siteId, onOpenPlan }: { warnings: ConflictWarning[]; tierSource?: ChangeConflicts['tierSource']; siteId: string; onOpenPlan: (plan: { id: string }) => void }) {
  const t = useChangeT();
  if (!warnings.length) return null;
  return <div className="change-warning change-conflicts" aria-label={t('changePlans.execution.conflictWarnings')}>
    <strong>{t('changePlans.execution.warningsBeforeImplementing')}</strong> <small>{t('changePlans.execution.nonBlocking')}</small>
    {warnings.map((warning) => <p key={warning.code}><b>{warningText(t, warning.code)}</b>{' · '}
      {warning.code === 'OUTSIDE_MAINTENANCE_WINDOW' && <>{warning.maintenanceWindowCount ? t('changePlans.conflicts.uncovered', { ranges: warning.uncovered.map((gap) => `${dateTime(gap.startsAt)} – ${dateTime(gap.endsAt)}`).join('; ') }) : t('changePlans.execution.noMaintenanceWindows')}</>}
      {(warning.code === 'TIER1_CRITICAL_ASSET' || warning.code === 'CRITICAL_ASSET') && <>{warning.devices.map((device, index) => <span key={device.id}>{index ? ', ' : ''}<EntityLink kind="device" id={device.id} label={device.name} siteId={siteId} /></span>)}{warning.code === 'CRITICAL_ASSET' && tierSource === 'IS_CRITICAL' ? ` ${t('changePlans.conflicts.markedCritical')}` : ''}</>}
      {warning.code === 'OVERLAPS_APPROVED_CHANGE' && warning.plans.map((other, index) => <span key={other.id}>{index ? '; ' : ''}<a href={`/alteracoes?changeId=${encodeURIComponent(other.id)}`} onClick={(event) => { event.preventDefault(); onOpenPlan(other); }}>{other.title}</a> · {statusText(t, other.status)} · {dateTime(other.plannedStartAt)} – {dateTime(other.plannedEndAt)}{other.sharedTargetCount ? ` · ${t('changePlans.sharedTargets', { count: other.sharedTargetCount })}` : ''}</span>)}
    </p>)}
  </div>;
}

/** "Como planeado / diferente" per target, with the compared fields. */
function PostChangeCheckView({ check, targetLabel }: { check: PostChangeCheck; targetLabel: ChangeExecutionProps['targetLabel'] }) {
  const t = useChangeT();
  return <div className="change-post-check">
    <div className="change-summary-grid">
      <div><small>{t('changePlans.execution.result')}</small><strong><span className={`state-badge ${checkTone[check.result]}`.trim()}><i />{checkText(t, check.result)}</span></strong></div>
      <div><small>{t('changePlans.execution.checkedAt')}</small><strong>{dateTime(check.checkedAt)}</strong></div>
    </div>
    {check.items.map((item) => <div className="change-target-item change-check-item" key={`${item.entityType}:${item.entityId}`}>
      <span>
        <strong>{typeText(t, item.entityType)} · {targetLabel(item)}</strong>
        <small>{item.operationSummary}</small>
        {item.fields.length > 0 && <table className="change-check-fields"><thead><tr><th scope="col">{t('changePlans.execution.field')}</th><th scope="col">{t('changePlans.execution.before')}</th><th scope="col">{t('changePlans.execution.planned')}</th><th scope="col">{t('changePlans.execution.current')}</th></tr></thead>
          <tbody>{item.fields.map((field) => <tr key={field.field} className={field.matches ? undefined : 'change-check-mismatch'}><td className="mono">{field.field}</td><td>{checkValue(field.before)}</td><td>{checkValue(field.planned)}</td><td>{checkValue(field.current)}{field.matches ? '' : ' ≠'}</td></tr>)}</tbody></table>}
        {item.result === 'NOT_COMPARABLE' && <small>{t('changePlans.execution.notComparable')}</small>}
      </span>
      <span className={`state-badge ${checkTone[item.result]}`.trim()}><i />{checkText(t, item.result)}</span>
    </div>)}
    {!check.items.length && <p className="change-muted">{t('changePlans.execution.noTargets')}</p>}
    {check.hiddenItemCount > 0 && <p className="change-muted">{t('changePlans.check.hidden', { count: check.hiddenItemCount })}</p>}
  </div>;
}

/**
 * Step 30: the plan's implementation — non-blocking conflict warnings, the
 * checklist, start/close with a closing note and the post-change check.
 */
export function ChangeExecution({ plan, canAct, confirm, targetLabel, onPlanChanged, onOpenPlan }: ChangeExecutionProps) {
  const t = useChangeT();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [newSteps, setNewSteps] = useState('');
  const [checklist, setChecklist] = useState<{ source: ChangePlan['checklist']; items: ChecklistItem[] } | null>(null);
  const [closeStatus, setCloseStatus] = useState<CloseStatus>('COMPLETED'); const [closingNote, setClosingNote] = useState('');
  const [conflicts, setConflicts] = useState<{ key: string; data: ChangeConflicts | null; failed: boolean } | null>(null);
  const [check, setCheck] = useState<{ key: string; data: PostChangeCheck | null; loading: boolean; failed: boolean } | null>(null);

  const status = plan.status;
  const closed = closedStatuses.has(status);
  // Local edits win until the plan itself is reloaded with a newer checklist.
  const items = checklist && checklist.source === plan.checklist ? checklist.items : plan.checklist ?? [];
  const progress = checklistProgress(items);
  const canEditSteps = canAct && checklistEditable.has(status);
  const canTick = canAct && status === 'IN_PROGRESS';
  const noteNeeded = closingNoteRequired(closeStatus);

  const conflictKey = conflictRelevant.has(status) ? `${plan.id}:${plan.revision}:${status}:${plan.plannedStartAt}:${plan.plannedEndAt}` : '';
  useEffect(() => {
    if (!conflictKey) return;
    let live = true;
    getChangeConflicts(plan.id).then((data) => { if (live) setConflicts({ key: conflictKey, data, failed: false }); }).catch(() => { if (live) setConflicts({ key: conflictKey, data: null, failed: true }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key covers the plan, its window and status
  }, [conflictKey]);
  const currentConflicts = conflictKey && conflicts?.key === conflictKey ? conflicts : null;

  // A closed plan shows its post-change check at once; while in progress it runs on request.
  const checkKey = `${plan.id}:${status}`;
  const runCheck = async () => {
    setCheck({ key: checkKey, data: check?.key === checkKey ? check.data : null, loading: true, failed: false });
    try { const data = await getPostChangeCheck(plan.id); setCheck({ key: checkKey, data, loading: false, failed: false }); }
    catch { setCheck({ key: checkKey, data: null, loading: false, failed: true }); }
  };
  useEffect(() => {
    if (!closed || check?.key === checkKey) return;
    void runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per closed plan
  }, [closed, checkKey]);
  const currentCheck = check?.key === checkKey ? check : null;

  const act = async (work: () => Promise<void>, fallback: string) => {
    setBusy(true); setError('');
    try { await work(); } catch (cause) { setError(message(cause, fallback)); } finally { setBusy(false); }
  };
  const addSteps = () => act(async () => {
    const labels = parseChecklistLines(newSteps);
    if (!labels.length) return;
    setChecklist({ source: plan.checklist, items: await addChecklistItems(plan.id, labels) }); setNewSteps('');
  }, t('changePlans.execution.addStepsFailed'));
  const tick = (item: ChecklistItem, done: boolean) => act(async () => {
    const updated = await tickChecklistItem(plan.id, item.id, done);
    setChecklist({ source: plan.checklist, items: items.map((current) => (current.id === item.id ? { ...current, ...updated } : current)) });
  }, t('changePlans.execution.updateStepFailed'));
  const remove = (item: ChecklistItem) => act(async () => {
    await removeChecklistItem(plan.id, item.id);
    setChecklist({ source: plan.checklist, items: items.filter((current) => current.id !== item.id) });
  }, t('changePlans.execution.removeStepFailed'));
  const start = async () => {
    const warningCount = currentConflicts?.data?.warnings.length ?? 0;
    if (!(await confirm({ title: t('changePlans.execution.startImplementation'), message: warningCount ? t('changePlans.start.confirmWarnings', { title: plan.title, count: warningCount }) : t('changePlans.start.confirm', { title: plan.title }), confirmLabel: t('changePlans.execution.startImplementation') }))) return;
    await act(async () => {
      const result = await startChangePlan(plan.id, plan.revision);
      await onPlanChanged(result.plan, result.warnings.length ? t('changePlans.start.doneWarnings', { count: result.warnings.length, warnings: result.warnings.map((warning) => warningText(t, warning.code)).join('; ') }) : t('changePlans.start.done'));
    }, t('changePlans.execution.startFailed'));
  };
  const close = async () => {
    if (noteNeeded && !closingNote.trim()) return;
    const pending = progress.total - progress.done;
    if (!(await confirm({ title: t('changePlans.execution.closeChange'), message: pending ? t('changePlans.close.confirmPending', { title: plan.title, outcome: closeText(t, closeStatus), count: pending }) : t('changePlans.close.confirm', { title: plan.title, outcome: closeText(t, closeStatus) }), confirmLabel: t('changePlans.execution.closeChange'), destructive: closeStatus !== 'COMPLETED' }))) return;
    await act(async () => {
      const result = await closeChangePlan(plan.id, closeStatus, closingNote.trim() || undefined);
      setCheck({ key: `${plan.id}:${result.plan.status}`, data: result.postChangeCheck, loading: false, failed: false });
      setClosingNote(''); setCloseStatus('COMPLETED');
      await onPlanChanged(result.plan, t('changePlans.close.done', { status: statusText(t, result.plan.status), check: checkText(t, result.postChangeCheck.result) }));
    }, t('changePlans.execution.closeFailed'));
  };

  const showChecklist = items.length > 0 || canEditSteps;
  const showCheck = status === 'IN_PROGRESS' || closed;

  return <section className="change-execution" aria-label={t('changePlans.execution.implementation')}>
    {error && <div className="ipam-alert error" role="alert">{error}</div>}
    {currentConflicts?.data && <ConflictWarnings warnings={currentConflicts.data.warnings} tierSource={currentConflicts.data.tierSource} siteId={plan.siteId} onOpenPlan={onOpenPlan} />}
    {currentConflicts?.failed && <p className="panel-description">{t('changePlans.execution.conflictsFailed')}</p>}

    {(plan.startedAt || plan.closedAt) && <div className="change-summary-grid">
      <div><small>{t('changePlans.execution.implementationStarted')}</small><strong>{who(plan.startedBy, plan.startedAt)}</strong></div>
      {plan.closedAt && <div><small>{t('changePlans.execution.closed')}</small><strong>{who(plan.closedBy, plan.closedAt)}</strong></div>}
    </div>}
    {plan.closingNote && <div className="change-warning"><strong>{t('changePlans.execution.closingNoteLabel')}</strong> {plan.closingNote}</div>}

    {showChecklist && <section className="change-review change-checklist" aria-labelledby="change-checklist-title">
      <div className="change-section-heading panel-heading"><div><h3 id="change-checklist-title">{t('changePlans.execution.checklist')}</h3></div>{progress.total > 0 && <span className="change-count" aria-label={t('changePlans.checklist.progress', { done: progress.done, total: progress.total })}>{progress.done}/{progress.total}</span>}</div>
      {!items.length && <p className="change-muted">{t('changePlans.execution.noSteps')}</p>}
      {items.length > 0 && <ol className="change-target-list">{items.map((item) => <li className="change-target-item" key={item.id}>
        <label className="change-check-step"><input type="checkbox" checked={Boolean(item.doneAt)} disabled={!canTick || busy} onChange={(event) => void tick(item, event.target.checked)} />
          <span><strong>{item.label}</strong>{item.doneAt ? <small>{t('changePlans.checklist.doneBy', { who: who(item.doneBy, item.doneAt) })}</small> : <small>{status === 'IN_PROGRESS' ? t('changePlans.execution.toDo') : t('changePlans.execution.stepsDuringImplementation')}</small>}</span></label>
        {canEditSteps && !item.doneAt && <button type="button" className="secondary-button" disabled={busy} aria-label={t('changePlans.checklist.remove', { label: item.label })} onClick={() => void remove(item)}>{t('changePlans.execution.remove')}</button>}
      </li>)}</ol>}
      {canEditSteps && <><label>{t('changePlans.execution.newSteps')}<textarea value={newSteps} maxLength={12000} onChange={(event) => setNewSteps(event.target.value)} placeholder={t('changePlans.execution.newStepsPlaceholder')} /></label>
        <div className="change-actions"><button type="button" className="secondary-button" disabled={busy || !parseChecklistLines(newSteps).length} onClick={() => void addSteps()}>{t('changePlans.execution.addSteps')}</button></div></>}
    </section>}

    {canAct && status === 'APPROVED' && <div className="change-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void start()}>{t('changePlans.execution.startImplementation')}</button></div>}

    {canAct && status === 'IN_PROGRESS' && <section className="change-review" aria-labelledby="change-close-title">
      <h3 id="change-close-title">{t('changePlans.execution.closeChange')}</h3>
      <label>{t('changePlans.execution.result')}<select value={closeStatus} onChange={(event) => setCloseStatus(event.target.value as CloseStatus)}>{closeStatuses.map((value) => <option key={value} value={value}>{closeText(t, value)}</option>)}</select></label>
      <label>{noteNeeded ? t('changePlans.close.noteRequired') : t('changePlans.close.noteOptional')}<textarea maxLength={2000} required={noteNeeded} value={closingNote} onChange={(event) => setClosingNote(event.target.value)} placeholder={noteNeeded ? t('changePlans.execution.failedNotePlaceholder') : t('changePlans.execution.notesPlaceholder')} /></label>
      {progress.total > progress.done && <p className="change-muted">{t('changePlans.close.stepsLeft', { count: progress.total - progress.done })}</p>}
      <div className="change-actions"><button type="button" className="primary-button" disabled={busy || (noteNeeded && !closingNote.trim())} title={noteNeeded && !closingNote.trim() ? t('changePlans.execution.closingNoteNeeded') : undefined} onClick={() => void close()}>{t('changePlans.execution.closeChange')}</button></div>
    </section>}

    {showCheck && <section className="change-review" aria-labelledby="change-check-title">
      <div className="change-section-heading panel-heading"><div><h3 id="change-check-title">{t('changePlans.execution.postChangeCheck')}</h3><p className="panel-description">{t('changePlans.execution.postChangeCheckDescription')}</p></div>
        <button type="button" className="secondary-button" disabled={currentCheck?.loading} onClick={() => void runCheck()}>{currentCheck?.loading ? t('changePlans.execution.checking') : currentCheck?.data ? t('changePlans.execution.checkAgain') : t('changePlans.execution.checkNow')}</button></div>
      {currentCheck?.failed && <p className="panel-description">{t('changePlans.execution.checkFailed')}</p>}
      {currentCheck?.data && <PostChangeCheckView check={currentCheck.data} targetLabel={targetLabel} />}
    </section>}

    {plan.snmpWrites && plan.snmpWrites.length > 0 && <section className="change-review" aria-labelledby="change-snmp-title">
      <h3 id="change-snmp-title">{t('changePlans.execution.snmpWrites')}</h3>
      <ul className="change-target-list">{plan.snmpWrites.map((write) => <li className="change-target-item" key={write.id}><span><strong>{write.operation}</strong><small><EntityLink kind="device" id={write.deviceId} label={targetLabel({ entityType: 'DEVICE', entityId: write.deviceId })} siteId={plan.siteId} /> · {write.status} · {dateTime(write.requestedAt)}</small></span></li>)}</ul>
    </section>}
  </section>;
}
