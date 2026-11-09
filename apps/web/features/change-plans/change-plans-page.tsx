'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/lib/auth';
import { useSiteContext } from '@/lib/site-context';
import { cancelChangePlan, createChangePlan, getChangeCandidates, getChangePlan, listChangePlans, previewChangePlan, reviewChangePlan, submitChangePlan, updateChangePlan, type ChangeCandidate, type ChangeDraft, type ChangeEntityType, type ChangeItem, type ChangePlan, type ImpactNode, type ImpactPreview } from './api';

const types: ChangeEntityType[] = ['DEVICE', 'INTERFACE', 'VLAN', 'SUBNET', 'IP_ADDRESS', 'HOST', 'SERVICE'];
const typeLabels: Record<ChangeEntityType, string> = { DEVICE: 'Equipamento', INTERFACE: 'Interface', VLAN: 'VLAN', SUBNET: 'Subnet', IP_ADDRESS: 'Endereço IP', HOST: 'Host', SERVICE: 'Serviço' };
const statusLabels: Record<string, string> = { DRAFT: 'Rascunho', SUBMITTED: 'Submetida para revisão', APPROVED: 'Aprovada', REJECTED: 'Devolvida para correção', CANCELLED: 'Cancelada' };
const blankDraft = (): ChangeDraft => ({ siteId: '', title: '', reason: '', plannedStartAt: '', plannedEndAt: '', items: [] });
const localInput = (value?: string) => { if (!value) return ''; const date = new Date(value); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000); return local.toISOString().slice(0, 16); };
const isoValue = (value: string) => value ? new Date(value).toISOString() : '';
const dateTime = (value: string) => new Date(value).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' });
type PreviewTransition = { planId: string; status: 'calculating' } | { planId: string; status: 'complete'; revision: number; snapshot: ImpactPreview };

export function ChangePlansPage() {
  const { siteId, activeSite } = useSiteContext(); const { hasRole } = useAuth();
  const canDraft = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR'].some(hasRole); const canReview = hasRole('ADMIN');
  const [plans, setPlans] = useState<ChangePlan[]>([]); const [candidates, setCandidates] = useState<ChangeCandidate[]>([]); const [candidateLimit, setCandidateLimit] = useState(false);
  const [selected, setSelected] = useState<ChangePlan | null>(null); const [draft, setDraft] = useState<ChangeDraft>(blankDraft()); const [editorOpen, setEditorOpen] = useState(false);
  const [targetType, setTargetType] = useState<ChangeEntityType>('DEVICE'); const [targetId, setTargetId] = useState(''); const [operation, setOperation] = useState(''); const [currentValue, setCurrentValue] = useState(''); const [proposedValue, setProposedValue] = useState('');
  const [reviewNote, setReviewNote] = useState(''); const [previewTransition, setPreviewTransition] = useState<PreviewTransition | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const selectedRequest = useRef(0);
  const visibleCandidates = useMemo(() => candidates.filter((item) => item.entityType === targetType), [candidates, targetType]);
  const load = useCallback(async () => {
    const requestId = ++selectedRequest.current;
    const selectedId = selected?.id;
    if (!siteId) { setPlans([]); setCandidates([]); setSelected(null); setPreviewTransition(null); return; }
    try {
      const [nextPlans, candidateResult] = await Promise.all([listChangePlans(siteId), getChangeCandidates(siteId)]);
      setPlans(nextPlans); setCandidates(candidateResult.groups.flat()); setCandidateLimit(candidateResult.truncated); setError('');
      if (selectedId) { const updated = nextPlans.find((item) => item.id === selectedId); if (updated) { const detail = await getChangePlan(updated.id); if (requestId === selectedRequest.current) setSelected(detail); } else if (requestId === selectedRequest.current) { setSelected(null); } }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as alterações deste Site.'); }
  }, [siteId, selected?.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { selectedRequest.current += 1; setDraft((previous) => ({ ...previous, siteId: siteId ?? '' })); setSelected(null); setPreviewTransition(null); setBusy(false); setNotice(''); setEditorOpen(false); }, [siteId]);

  const openNew = () => { selectedRequest.current += 1; setSelected(null); setPreviewTransition(null); setDraft({ ...blankDraft(), siteId: siteId ?? '' }); setTargetType('DEVICE'); setTargetId(''); setOperation(''); setCurrentValue(''); setProposedValue(''); setError(''); setNotice(''); setEditorOpen(true); };
  const openEdit = (plan: ChangePlan) => { setSelected(plan); setDraft({ siteId: plan.siteId, title: plan.title, reason: plan.reason, plannedStartAt: localInput(plan.plannedStartAt), plannedEndAt: localInput(plan.plannedEndAt), items: plan.items.map((item) => ({ ...item })) }); setEditorOpen(true); setError(''); };
  const openPlan = async (plan: ChangePlan) => { const requestId = ++selectedRequest.current; setPreviewTransition(null); setBusy(true); setError(''); setNotice(''); try { const detail = await getChangePlan(plan.id); if (requestId === selectedRequest.current) { setSelected(detail); setEditorOpen(false); setReviewNote(''); } } catch (cause) { if (requestId === selectedRequest.current) setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a alteração.'); } finally { if (requestId === selectedRequest.current) setBusy(false); } };
  const addTarget = () => {
    const candidate = candidates.find((item) => item.entityId === targetId && item.entityType === targetType);
    if (!candidate || !operation.trim() || draft.items.some((item) => item.entityId === targetId && item.entityType === targetType)) return;
    const objectValue = (value: string) => value.trim() ? { summary: value.trim() } : undefined;
    setDraft((current) => ({ ...current, items: [...current.items, { entityType: targetType, entityId: targetId, operationSummary: operation.trim(), currentValue: objectValue(currentValue), proposedValue: objectValue(proposedValue) }] }));
    setTargetId(''); setOperation(''); setCurrentValue(''); setProposedValue('');
  };
  const removeTarget = (item: ChangeItem) => { setDraft((current) => ({ ...current, items: current.items.filter((target) => !(target.entityType === item.entityType && target.entityId === item.entityId)) })); };
  const persist = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = { ...draft, plannedStartAt: isoValue(draft.plannedStartAt), plannedEndAt: isoValue(draft.plannedEndAt) };
      const saved = selected ? await updateChangePlan(selected.id, selected.revision, { title: payload.title, reason: payload.reason, plannedStartAt: payload.plannedStartAt, plannedEndAt: payload.plannedEndAt, items: payload.items }) : await createChangePlan(payload);
      const detail = await getChangePlan(saved.id); setSelected(detail); setEditorOpen(false); setNotice('Rascunho guardado. Calcula a pré-visualização antes de submeter para revisão.'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível guardar o rascunho.'); }
    finally { setBusy(false); }
  };
  const calculate = async () => {
    if (!selected) return;
    const planId = selected.id;
    const planRevision = selected.revision;
    const requestId = ++selectedRequest.current;
    setBusy(true); setPreviewTransition({ planId, status: 'calculating' }); setError(''); setNotice('');
    try {
      const result = await previewChangePlan(planId);
      if (requestId !== selectedRequest.current) return;
      if (result.revision !== planRevision) throw new Error('A alteração mudou durante a análise. Atualiza a alteração e calcula novamente.');
      setSelected({ ...selected, previewRevision: result.revision, previewSnapshot: result, previewedAt: result.generatedAt });
      setPreviewTransition({ planId, status: 'complete', revision: result.revision, snapshot: result });
    }
    catch (cause) {
      if (requestId === selectedRequest.current) {
        setSelected((current) => current?.id === planId ? { ...current, previewRevision: null, previewSnapshot: null, previewedAt: null } : current);
        setError(cause instanceof Error ? cause.message : 'Não foi possível calcular o impacto.');
        setPreviewTransition(null); setNotice('');
      }
    }
    finally { if (requestId === selectedRequest.current) setBusy(false); }
  };
  const submit = async () => {
    if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try { const result = await submitChangePlan(selected.id); const detail = await getChangePlan(result.id); setSelected(detail); setNotice('Alteração submetida para revisão.'); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível submeter a alteração.'); }
    finally { setBusy(false); }
  };
  const review = async (status: 'APPROVED' | 'REJECTED') => {
    if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try { const result = await reviewChangePlan(selected.id, status, reviewNote.trim() || undefined); const detail = await getChangePlan(result.id); setSelected(detail); setNotice(status === 'APPROVED' ? 'Alteração aprovada.' : 'Alteração devolvida para correção.'); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível registar a revisão.'); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try { const result = await cancelChangePlan(selected.id); const detail = await getChangePlan(result.id); setSelected(detail); setNotice('Alteração cancelada.'); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível cancelar a alteração.'); }
    finally { setBusy(false); }
  };

  const currentTransition = selected && previewTransition?.planId === selected.id ? previewTransition : null;
  const savedPreview = selected && currentTransition?.status === 'calculating' ? null
    : selected && currentTransition?.status === 'complete' && currentTransition.revision === selected.revision ? currentTransition.snapshot
      : selected && selected.previewRevision === selected.revision ? selected.previewSnapshot : null;
  const canSubmit = Boolean(selected && selected.previewRevision === selected.revision && savedPreview?.analysisStatus === 'COMPLETE' && savedPreview.coverage.status !== 'PARTIAL' && ['DRAFT', 'REJECTED'].includes(selected.status));
  const canEdit = Boolean(selected && canDraft && ['DRAFT', 'REJECTED'].includes(selected.status));
  const impactGroups = useMemo(() => {
    const grouped = new Map<ChangeEntityType, ImpactNode[]>();
    for (const item of savedPreview?.knownImpacts ?? []) grouped.set(item.entityType, [...(grouped.get(item.entityType) ?? []), item]);
    return [...grouped.entries()];
  }, [savedPreview]);

  return <AppShell section="Alterações"><main className="module-page change-plans-page"><header className="workspace-head"><div><span className="section-kicker">PLANEAMENTO OPERACIONAL</span><h1>Alterações planeadas</h1><p>{activeSite ? `${activeSite.name} · ` : ''}Avalia as dependências registadas antes de submeter uma alteração para revisão.</p></div><div className="change-page-actions"><button className="secondary-button" disabled={!siteId || busy} onClick={() => void load()}>Atualizar</button>{canDraft && <button className="primary-button" disabled={!siteId || busy} onClick={openNew}>＋ Criar alteração</button>}</div></header>
    {error && <div className="ipam-alert error" role="alert">{error}</div>}{notice && <div className="ipam-alert change-success" role="status">{notice}</div>}
    {selected && currentTransition?.status === 'calculating' && <div className="ipam-alert" role="status">A calcular a pré-visualização…</div>}
    {selected && currentTransition?.status === 'complete' && currentTransition.revision === selected.revision && savedPreview && <div className="ipam-alert change-success" role="status">Pré-visualização atualizada. Revê os impactos e a cobertura antes de submeter.</div>}
    {!siteId && <section className="ipam-card"><div className="no-data">Seleciona um Site na barra lateral para ver ou criar alterações.</div></section>}
    {siteId && <div className="change-layout"><section className="ipam-card change-list-card"><div className="change-section-heading"><div><span className="section-kicker">REGISTOS DO SITE</span><h2>Alterações</h2></div><span className="change-count">{plans.length}</span></div>{plans.length ? <div className="change-plan-list">{plans.map((plan) => <button type="button" className={`change-plan-row ${selected?.id === plan.id ? 'selected' : ''}`} key={plan.id} onClick={() => void openPlan(plan)}><span className={`change-status status-${plan.status.toLowerCase()}`}>{statusLabels[plan.status]}</span><strong>{plan.title}</strong><small>{dateTime(plan.plannedStartAt)} – {dateTime(plan.plannedEndAt)}</small><small>{plan.items.length} alvo(s) · revisão {plan.revision}</small></button>)}</div> : <div className="no-data">Ainda não há alterações registadas neste Site.</div>}</section>
      <div className="change-main-column">{editorOpen && <section className="ipam-card change-editor" aria-labelledby="change-editor-title"><div className="change-section-heading"><div><span className="section-kicker">RASCUNHO</span><h2 id="change-editor-title">{selected ? 'Editar alteração' : 'Criar alteração'}</h2></div><button className="secondary-button" onClick={() => setEditorOpen(false)}>Fechar</button></div><p className="change-muted">A pré-visualização é somente de leitura. A alteração não modifica equipamentos nem reserva recursos.</p><div className="change-form-grid"><label>Título<input required maxLength={160} value={draft.title} onChange={(event) => { setDraft({ ...draft, title: event.target.value }); }} placeholder="Ex.: Atualização do switch central" /></label><label>Motivo<textarea required maxLength={1000} value={draft.reason} onChange={(event) => { setDraft({ ...draft, reason: event.target.value }); }} placeholder="Explica o objetivo e a necessidade da alteração" /></label><label>Início planeado<input required type="datetime-local" value={draft.plannedStartAt} onChange={(event) => { setDraft({ ...draft, plannedStartAt: event.target.value }); }} /></label><label>Fim planeado<input required type="datetime-local" value={draft.plannedEndAt} onChange={(event) => { setDraft({ ...draft, plannedEndAt: event.target.value }); }} /></label></div><h3>Alvos e operação proposta</h3><div className="change-target-builder"><label>Tipo<select value={targetType} onChange={(event) => { setTargetType(event.target.value as ChangeEntityType); setTargetId(''); }}><option value="">Seleciona um tipo</option>{types.map((type) => <option value={type} key={type}>{typeLabels[type]}</option>)}</select></label><label className="change-target-select">Alvo<select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Seleciona um alvo</option>{visibleCandidates.map((candidate) => <option value={candidate.entityId} key={candidate.entityId}>{candidate.label}{candidate.detail ? ` · ${candidate.detail}` : ''}</option>)}</select></label><label>Operação proposta<input value={operation} maxLength={240} onChange={(event) => setOperation(event.target.value)} placeholder="Ex.: Atualizar firmware para 9.4.2" /></label><label>Valor atual (opcional)<input value={currentValue} onChange={(event) => setCurrentValue(event.target.value)} placeholder="Ex.: versão 9.3.7" /></label><label>Valor proposto (opcional)<input value={proposedValue} onChange={(event) => setProposedValue(event.target.value)} placeholder="Ex.: versão 9.4.2" /></label><button type="button" className="secondary-button change-add-target" disabled={!targetId || !operation.trim()} onClick={addTarget}>Adicionar alvo</button></div>{candidateLimit && <div className="change-warning">A lista de alvos foi limitada. Usa um detalhe de equipamento para iniciar com o alvo selecionado ou reduz o âmbito do Site.</div>}<div className="change-target-list">{draft.items.map((item) => <div className="change-target-item" key={`${item.entityType}:${item.entityId}`}><span><strong>{typeLabels[item.entityType]}</strong><small>{candidates.find((candidate) => candidate.entityType === item.entityType && candidate.entityId === item.entityId)?.label ?? item.entityId} · {item.operationSummary}</small>{item.currentValue?.summary ? <small>Atual: {String(item.currentValue.summary)} → Proposto: {String(item.proposedValue?.summary ?? '—')}</small> : null}</span><button type="button" className="secondary-button" onClick={() => removeTarget(item)}>Remover</button></div>)}{!draft.items.length && <p className="change-muted">Adiciona pelo menos um equipamento, interface, VLAN, subnet, IP, Host ou serviço.</p>}</div><div className="change-actions"><button type="button" className="secondary-button" disabled={busy || !draft.title.trim() || !draft.reason.trim() || !draft.plannedStartAt || !draft.plannedEndAt || !draft.items.length} onClick={() => void persist()}>{busy ? 'A guardar…' : 'Guardar rascunho'}</button></div></section>}
      {selected && !editorOpen && <section className="ipam-card change-detail"><div className="change-section-heading"><div><span className="section-kicker">{selected.id.slice(0, 8).toUpperCase()} · REVISÃO {selected.revision}</span><h2>{selected.title}</h2></div><span className={`change-status status-${selected.status.toLowerCase()}`}>{statusLabels[selected.status]}</span></div><p>{selected.reason}</p><div className="change-summary-grid"><div><small>Site</small><strong>{activeSite?.name ?? 'Site selecionado'}</strong></div><div><small>Janela planeada</small><strong>{dateTime(selected.plannedStartAt)} – {dateTime(selected.plannedEndAt)}</strong></div><div><small>Alvos</small><strong>{selected.items.length}</strong></div><div><small>Pré-visualização</small><strong>{savedPreview ? `Calculada ${dateTime(savedPreview.generatedAt)}` : currentTransition?.status === 'calculating' ? 'A calcular…' : 'Por calcular'}</strong></div></div><div className="change-target-list">{selected.items.map((item) => <div className="change-target-item" key={`${item.entityType}:${item.entityId}`}><span><strong>{typeLabels[item.entityType]}</strong><small>{candidates.find((candidate) => candidate.entityType === item.entityType && candidate.entityId === item.entityId)?.label ?? item.entityId} · {item.operationSummary}</small></span></div>)}</div>
        {savedPreview && <section className="impact-preview" aria-labelledby="impact-preview-title"><div className="change-section-heading"><div><span className="section-kicker">PRÉ-VISUALIZAÇÃO SOMENTE DE LEITURA</span><h3 id="impact-preview-title">Impacto conhecido</h3></div><span className={`change-status status-${savedPreview.coverage.status.toLowerCase()}`}>{savedPreview.coverage.status === 'PARTIAL' ? 'Cobertura parcial' : 'Análise concluída'}</span></div><div className="change-summary-grid"><div><small>Impactos conhecidos</small><strong>{savedPreview.knownImpacts.length}</strong></div><div><small>Dados antigos (&gt;24 h)</small><strong>{savedPreview.coverage.staleItems}</strong></div><div><small>Atualização do inventário</small><strong>{savedPreview.coverage.latestInventoryUpdate ? dateTime(savedPreview.coverage.latestInventoryUpdate) : 'Sem registo'}</strong></div></div><p className={savedPreview.coverage.status === 'PARTIAL' ? 'change-warning' : 'change-muted'}>{savedPreview.coverage.reason}</p>{!savedPreview.knownImpacts.length && <div className="change-empty-impact"><strong>Não foram encontradas relações registadas.</strong><span>Este resultado não confirma impacto zero.</span></div>}{impactGroups.map(([type, items]) => <div className="impact-group" key={type}><h4>{typeLabels[type]} · {items.length}</h4><ul>{items.map((item) => <li key={`${item.entityType}:${item.entityId}`}><a href={item.href}>{item.label}</a><span>{item.depth === 1 ? 'Dependência direta' : `Dependência a ${item.depth} níveis`} · {item.dependencyPath.join(' → ')} · {item.freshness === 'STALE' ? 'Observação com mais de 24 h' : item.freshness === 'UNKNOWN' ? 'Atualização desconhecida' : 'Observado nas últimas 24 h'}{item.confidence === 'LOW' ? ' · confiança baixa (SNMP)' : ''}</span></li>)}</ul></div>)}{savedPreview.maintenanceOverlaps.length > 0 && <div className="change-warning"><strong>Sobreposição com manutenção existente</strong>{savedPreview.maintenanceOverlaps.map((item) => <p key={item.id}>{item.name} · {dateTime(item.startsAt)} – {dateTime(item.endsAt)}{item.reason ? ` · ${item.reason}` : ''}</p>)}</div>}{savedPreview.changeOverlaps.length > 0 && <div className="change-warning"><strong>Sobreposição com alterações submetidas/aprovadas</strong>{savedPreview.changeOverlaps.map((item) => <p key={item.id}><a href={`/alteracoes?changeId=${item.id}`}>{item.title}</a> · {dateTime(item.plannedStartAt)} – {dateTime(item.plannedEndAt)}</p>)}</div>}<p className="change-muted">A análise cobre relações registadas no inventário até {dateTime(savedPreview.generatedAt)}. Não aplica alterações nem garante que todas as dependências estejam documentadas.</p></section>}
        {selected.reviewNote && <div className="change-warning"><strong>Nota de revisão:</strong> {selected.reviewNote}</div>}
        <div className="change-actions">{canEdit && <button className="secondary-button" disabled={busy} onClick={() => openEdit(selected)}>Editar rascunho</button>}{canEdit && <button className="secondary-button" disabled={busy} onClick={() => void calculate()}>{busy ? 'A calcular…' : 'Recalcular pré-visualização'}</button>}{canEdit && <button className="primary-button" disabled={busy || !canSubmit} title={!canSubmit ? 'Guarda uma pré-visualização completa e atual antes de submeter.' : undefined} onClick={() => void submit()}>Submeter para revisão</button>}{canDraft && ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(selected.status) && <button className="secondary-button" disabled={busy} onClick={() => void cancel()}>Cancelar alteração</button>}</div>
        {canReview && selected.status === 'SUBMITTED' && <section className="change-review"><h3>Revisão administrativa</h3><label>Nota de revisão<textarea maxLength={1000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Obrigatória para devolver para correção" /></label><div className="change-actions"><button className="secondary-button" disabled={busy || !reviewNote.trim()} onClick={() => void review('REJECTED')}>Devolver para correção</button><button className="primary-button" disabled={busy} onClick={() => void review('APPROVED')}>Aprovar alteração</button></div></section>}
      </section>}
      {!selected && !editorOpen && <section className="ipam-card change-empty"><span className="section-kicker">ANTES DA EXECUÇÃO</span><h2>Regista a alteração e revê as dependências</h2><p>Seleciona os alvos, descreve a operação e define a janela planeada. A pré-visualização fica guardada com a alteração e é obrigatória antes da submissão para revisão.</p>{canDraft ? <button className="primary-button" onClick={openNew}>Criar alteração</button> : <p className="change-muted">Tens acesso de leitura. Um operador autorizado pode criar alterações neste Site.</p>}</section>}</div></div>}
    </main></AppShell>;
}
