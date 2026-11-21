'use client';

import { useEffect, useState } from 'react';
import { EntityLink } from '@/components/data-table';
import type { ConfirmFn } from '@/components/ui/confirm-dialog';
import { formatDateTime } from '@/lib/format/date';
import { addChecklistItems, closeChangePlan, getChangeConflicts, getPostChangeCheck, removeChecklistItem, startChangePlan, tickChecklistItem, type ChangeConflicts, type ChangeEntityType, type ChangePlan, type ChecklistItem, type CloseStatus, type ConflictWarning, type PostChangeCheck } from './api';
import { checkLabels, checklistEditable, checklistProgress, checkTone, checkValue, closedStatuses, closeLabels, closeStatuses, closingNoteRequired, conflictRelevant, parseChecklistLines, personName, statusLabels, typeLabels, warningTitles } from './workspace';

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
  if (!warnings.length) return null;
  return <div className="change-warning change-conflicts" aria-label="Avisos de conflito">
    <strong>Avisos antes de implementar</strong> <small>Não bloqueiam a alteração.</small>
    {warnings.map((warning) => <p key={warning.code}><b>{warningTitles[warning.code]}</b>{' · '}
      {warning.code === 'OUTSIDE_MAINTENANCE_WINDOW' && <>{warning.maintenanceWindowCount ? `Sem cobertura: ${warning.uncovered.map((gap) => `${dateTime(gap.startsAt)} – ${dateTime(gap.endsAt)}`).join('; ')}` : 'Este Site não tem janelas de manutenção nesse período.'}</>}
      {(warning.code === 'TIER1_CRITICAL_ASSET' || warning.code === 'CRITICAL_ASSET') && <>{warning.devices.map((device, index) => <span key={device.id}>{index ? ', ' : ''}<EntityLink kind="device" id={device.id} label={device.name} siteId={siteId} /></span>)}{warning.code === 'CRITICAL_ASSET' && tierSource === 'IS_CRITICAL' ? ' (marcados como críticos; ainda sem tier)' : ''}</>}
      {warning.code === 'OVERLAPS_APPROVED_CHANGE' && warning.plans.map((other, index) => <span key={other.id}>{index ? '; ' : ''}<a href={`/alteracoes?changeId=${encodeURIComponent(other.id)}`} onClick={(event) => { event.preventDefault(); onOpenPlan(other); }}>{other.title}</a> · {statusLabels[other.status] ?? other.status} · {dateTime(other.plannedStartAt)} – {dateTime(other.plannedEndAt)}{other.sharedTargetCount ? ` · ${other.sharedTargetCount === 1 ? '1 alvo em comum' : `${other.sharedTargetCount} alvos em comum`}` : ''}</span>)}
    </p>)}
  </div>;
}

/** "Como planeado / diferente" per target, with the compared fields. */
function PostChangeCheckView({ check, targetLabel }: { check: PostChangeCheck; targetLabel: ChangeExecutionProps['targetLabel'] }) {
  return <div className="change-post-check">
    <div className="change-summary-grid">
      <div><small>Resultado</small><strong><span className={`state-badge ${checkTone[check.result]}`.trim()}><i />{checkLabels[check.result]}</span></strong></div>
      <div><small>Verificado em</small><strong>{dateTime(check.checkedAt)}</strong></div>
    </div>
    {check.items.map((item) => <div className="change-target-item change-check-item" key={`${item.entityType}:${item.entityId}`}>
      <span>
        <strong>{typeLabels[item.entityType] ?? item.entityType} · {targetLabel(item)}</strong>
        <small>{item.operationSummary}</small>
        {item.fields.length > 0 && <table className="change-check-fields"><thead><tr><th scope="col">Campo</th><th scope="col">Antes</th><th scope="col">Planeado</th><th scope="col">Atual</th></tr></thead>
          <tbody>{item.fields.map((field) => <tr key={field.field} className={field.matches ? undefined : 'change-check-mismatch'}><td className="mono">{field.field}</td><td>{checkValue(field.before)}</td><td>{checkValue(field.planned)}</td><td>{checkValue(field.current)}{field.matches ? '' : ' ≠'}</td></tr>)}</tbody></table>}
        {item.result === 'NOT_COMPARABLE' && <small>Este alvo não tem valores propostos que possam ser comparados com o inventário.</small>}
      </span>
      <span className={`state-badge ${checkTone[item.result]}`.trim()}><i />{checkLabels[item.result]}</span>
    </div>)}
    {!check.items.length && <p className="change-muted">Não há alvos para comparar.</p>}
    {check.hiddenItemCount > 0 && <p className="change-muted">{check.hiddenItemCount === 1 ? '1 alvo não aparece porque não tens acesso a ele.' : `${check.hiddenItemCount} alvos não aparecem porque não tens acesso a eles.`}</p>}
  </div>;
}

/**
 * Step 30: the plan's implementation — non-blocking conflict warnings, the
 * checklist, start/close with a closing note and the post-change check.
 */
export function ChangeExecution({ plan, canAct, confirm, targetLabel, onPlanChanged, onOpenPlan }: ChangeExecutionProps) {
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
  }, 'Não foi possível adicionar os passos.');
  const tick = (item: ChecklistItem, done: boolean) => act(async () => {
    const updated = await tickChecklistItem(plan.id, item.id, done);
    setChecklist({ source: plan.checklist, items: items.map((current) => (current.id === item.id ? { ...current, ...updated } : current)) });
  }, 'Não foi possível atualizar o passo.');
  const remove = (item: ChecklistItem) => act(async () => {
    await removeChecklistItem(plan.id, item.id);
    setChecklist({ source: plan.checklist, items: items.filter((current) => current.id !== item.id) });
  }, 'Não foi possível remover o passo.');
  const start = async () => {
    const warningCount = currentConflicts?.data?.warnings.length ?? 0;
    if (!(await confirm({ title: 'Iniciar implementação', message: `Iniciar “${plan.title}”? O início fica registado na auditoria.${warningCount ? ` Há ${warningCount === 1 ? '1 aviso' : `${warningCount} avisos`} de conflito; não impedem o início.` : ''}`, confirmLabel: 'Iniciar implementação' }))) return;
    await act(async () => {
      const result = await startChangePlan(plan.id, plan.revision);
      await onPlanChanged(result.plan, result.warnings.length ? `Implementação iniciada com ${result.warnings.length === 1 ? '1 aviso' : `${result.warnings.length} avisos`}: ${result.warnings.map((warning) => warningTitles[warning.code]).join('; ')}.` : 'Implementação iniciada.');
    }, 'Não foi possível iniciar a implementação.');
  };
  const close = async () => {
    if (noteNeeded && !closingNote.trim()) return;
    const pending = progress.total - progress.done;
    if (!(await confirm({ title: 'Encerrar alteração', message: `Encerrar “${plan.title}” como “${closeLabels[closeStatus]}”?${pending ? ` Ainda há ${pending === 1 ? '1 passo' : `${pending} passos`} por concluir na lista.` : ''} Uma alteração encerrada não pode ser reaberta.`, confirmLabel: 'Encerrar alteração', destructive: closeStatus !== 'COMPLETED' }))) return;
    await act(async () => {
      const result = await closeChangePlan(plan.id, closeStatus, closingNote.trim() || undefined);
      setCheck({ key: `${plan.id}:${result.plan.status}`, data: result.postChangeCheck, loading: false, failed: false });
      setClosingNote(''); setCloseStatus('COMPLETED');
      await onPlanChanged(result.plan, `Alteração encerrada: ${statusLabels[result.plan.status] ?? closeLabels[closeStatus]}. Verificação pós-alteração: ${checkLabels[result.postChangeCheck.result]}.`);
    }, 'Não foi possível encerrar a alteração.');
  };

  const showChecklist = items.length > 0 || canEditSteps;
  const showCheck = status === 'IN_PROGRESS' || closed;

  return <section className="change-execution" aria-label="Implementação">
    {error && <div className="ipam-alert error" role="alert">{error}</div>}
    {currentConflicts?.data && <ConflictWarnings warnings={currentConflicts.data.warnings} tierSource={currentConflicts.data.tierSource} siteId={plan.siteId} onOpenPlan={onOpenPlan} />}
    {currentConflicts?.failed && <p className="panel-description">Não foi possível verificar os avisos de conflito.</p>}

    {(plan.startedAt || plan.closedAt) && <div className="change-summary-grid">
      <div><small>Implementação iniciada</small><strong>{who(plan.startedBy, plan.startedAt)}</strong></div>
      {plan.closedAt && <div><small>Encerrada</small><strong>{who(plan.closedBy, plan.closedAt)}</strong></div>}
    </div>}
    {plan.closingNote && <div className="change-warning"><strong>Nota de encerramento:</strong> {plan.closingNote}</div>}

    {showChecklist && <section className="change-review change-checklist" aria-labelledby="change-checklist-title">
      <div className="change-section-heading panel-heading"><div><h3 id="change-checklist-title">Lista de implementação</h3></div>{progress.total > 0 && <span className="change-count" aria-label={`${progress.done} de ${progress.total} passos concluídos`}>{progress.done}/{progress.total}</span>}</div>
      {!items.length && <p className="change-muted">Ainda não há passos definidos para esta alteração.</p>}
      {items.length > 0 && <ol className="change-target-list">{items.map((item) => <li className="change-target-item" key={item.id}>
        <label className="change-check-step"><input type="checkbox" checked={Boolean(item.doneAt)} disabled={!canTick || busy} onChange={(event) => void tick(item, event.target.checked)} />
          <span><strong>{item.label}</strong>{item.doneAt ? <small>Concluído por {who(item.doneBy, item.doneAt)}</small> : <small>{status === 'IN_PROGRESS' ? 'Por concluir' : 'Os passos marcam-se durante a implementação.'}</small>}</span></label>
        {canEditSteps && !item.doneAt && <button type="button" className="secondary-button" disabled={busy} aria-label={`Remover passo: ${item.label}`} onClick={() => void remove(item)}>Remover</button>}
      </li>)}</ol>}
      {canEditSteps && <><label>Novos passos (um por linha)<textarea value={newSteps} maxLength={12000} onChange={(event) => setNewSteps(event.target.value)} placeholder={'Ex.: Guardar a configuração atual\nAtualizar firmware\nConfirmar ligações'} /></label>
        <div className="change-actions"><button type="button" className="secondary-button" disabled={busy || !parseChecklistLines(newSteps).length} onClick={() => void addSteps()}>Adicionar passos</button></div></>}
    </section>}

    {canAct && status === 'APPROVED' && <div className="change-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void start()}>Iniciar implementação</button></div>}

    {canAct && status === 'IN_PROGRESS' && <section className="change-review" aria-labelledby="change-close-title">
      <h3 id="change-close-title">Encerrar alteração</h3>
      <label>Resultado<select value={closeStatus} onChange={(event) => setCloseStatus(event.target.value as CloseStatus)}>{closeStatuses.map((value) => <option key={value} value={value}>{closeLabels[value]}</option>)}</select></label>
      <label>Nota de encerramento{noteNeeded ? ' (obrigatória)' : ' (opcional)'}<textarea maxLength={2000} required={noteNeeded} value={closingNote} onChange={(event) => setClosingNote(event.target.value)} placeholder={noteNeeded ? 'Explica o que falhou ou porque foi revertida' : 'Notas sobre a implementação'} /></label>
      {progress.total > progress.done && <p className="change-muted">{progress.total - progress.done === 1 ? 'Falta 1 passo da lista.' : `Faltam ${progress.total - progress.done} passos da lista.`} Podes encerrar na mesma.</p>}
      <div className="change-actions"><button type="button" className="primary-button" disabled={busy || (noteNeeded && !closingNote.trim())} title={noteNeeded && !closingNote.trim() ? 'Indica uma nota de encerramento.' : undefined} onClick={() => void close()}>Encerrar alteração</button></div>
    </section>}

    {showCheck && <section className="change-review" aria-labelledby="change-check-title">
      <div className="change-section-heading panel-heading"><div><h3 id="change-check-title">Verificação pós-alteração</h3><p className="panel-description">Compara os valores propostos de cada alvo com o inventário atual.</p></div>
        <button type="button" className="secondary-button" disabled={currentCheck?.loading} onClick={() => void runCheck()}>{currentCheck?.loading ? 'A verificar…' : currentCheck?.data ? 'Verificar novamente' : 'Verificar agora'}</button></div>
      {currentCheck?.failed && <p className="panel-description">Não foi possível fazer a verificação pós-alteração.</p>}
      {currentCheck?.data && <PostChangeCheckView check={currentCheck.data} targetLabel={targetLabel} />}
    </section>}

    {plan.snmpWrites && plan.snmpWrites.length > 0 && <section className="change-review" aria-labelledby="change-snmp-title">
      <h3 id="change-snmp-title">Escritas SNMP associadas</h3>
      <ul className="change-target-list">{plan.snmpWrites.map((write) => <li className="change-target-item" key={write.id}><span><strong>{write.operation}</strong><small><EntityLink kind="device" id={write.deviceId} label={targetLabel({ entityType: 'DEVICE', entityId: write.deviceId })} siteId={plan.siteId} /> · {write.status} · {dateTime(write.requestedAt)}</small></span></li>)}</ul>
    </section>}
  </section>;
}
