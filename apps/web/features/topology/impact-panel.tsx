'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { safeHref } from '@/lib/safe-href';
import { getTopologyImpact, getTopologyPath, topologyImpactHref, type ImpactDevice, type ImpactTarget, type TopologyImpact, type TopologyPath } from './impact-api';

/**
 * Step 34 — "what is affected if this goes down", shared by Device 360, Topologia, the rack view and change plans.
 * Plain state rather than React Query: the rack view and the change-plan page render without a QueryClient.
 */

const LIST_LIMIT = 40;
const REASON_LABEL: Record<string, string> = { ORIGIN: 'Origem', RACK: 'No bastidor', POWER: 'Sem energia' };
const deviceHref = (id: string, siteId?: string | null) => `/infraestrutura/equipamentos/${encodeURIComponent(id)}${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`;

type Load<T> = { key: string; data: T | null; error: string };

function useImpact(target: ImpactTarget | null, includeLogical: boolean) {
  const key = target ? `${target.kind}:${target.id}:${includeLogical}` : '';
  const [state, setState] = useState<Load<TopologyImpact>>({ key: '', data: null, error: '' });
  useEffect(() => {
    if (!target) return;
    let live = true;
    getTopologyImpact(target, { includeLogical })
      .then((data) => { if (live) setState({ key, data, error: '' }); })
      .catch((reason: unknown) => { if (live) setState({ key, data: null, error: reason instanceof Error && reason.message ? reason.message : 'Não foi possível calcular o impacto.' }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key covers the target and the option
  }, [key]);
  return state.key === key ? { data: state.data, error: state.error, loading: false } : { data: null, error: '', loading: Boolean(target) };
}

function DeviceList({ devices, siteId, extra }: { devices: ImpactDevice[]; siteId?: string | null; extra?: (device: ImpactDevice) => ReactNode }) {
  return <ul className="device-360-list impact-device-list">
    {devices.slice(0, LIST_LIMIT).map((device) => <li key={device.id}>
      <a href={deviceHref(device.id, siteId)}>{device.name}</a>
      <span className="impact-meta">{device.type}</span>
      {device.criticalityTier ? <span className="state-badge excluded">{device.criticalityTier}</span> : device.isCritical ? <span className="state-badge excluded">Crítico</span> : null}
      {extra?.(device)}
    </li>)}
    {devices.length > LIST_LIMIT && <li className="impact-meta">+{devices.length - LIST_LIMIT}</li>}
  </ul>;
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (!count) return null;
  return <div className="impact-panel-group"><h4><span>{title}</span> · {count}</h4>{children}</div>;
}

export interface ImpactPanelProps {
  target: ImpactTarget | null;
  siteId?: string | null;
  /** Hides the "Ver na Topologia" link (already on the map). */
  onMap?: boolean;
  /** Receives every result, e.g. to highlight it on the map. */
  onResult?: (impact: TopologyImpact | null) => void;
  /** Heading level used inside a page section (h3) or a dialog (h3 as well; the dialog owns h2). */
  headingId?: string;
}

export function ImpactPanel({ target, siteId, onMap = false, onResult, headingId }: ImpactPanelProps) {
  const [includeLogical, setIncludeLogical] = useState(false);
  const { data, error, loading } = useImpact(target, includeLogical);
  // Keep the latest callback without re-firing it: callers may pass an inline function.
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; });
  useEffect(() => { onResultRef.current?.(data); }, [data]);
  if (!target) return null;
  const names = new Map<string, string>();
  for (const device of [...(data?.down ?? []), ...(data?.affected ?? [])]) names.set(device.id, device.name);
  const tier = (ids: string[]) => ids.map((id) => ({ id, name: names.get(id) ?? id }));
  const total = data ? data.counts.down + data.counts.affected + data.counts.powerDegraded + data.counts.hosts + data.counts.applications : 0;

  return <div className="impact-panel" data-testid="impact-panel" aria-labelledby={headingId} aria-busy={loading}>
    <div className="impact-toolbar">
      <label className="impact-toggle"><input type="checkbox" checked={includeLogical} onChange={(event) => setIncludeLogical(event.target.checked)} /> <span>Incluir ligações lógicas</span></label>
      {!onMap && <a className="text-button" href={topologyImpactHref(target, siteId)}><span>Ver na Topologia</span> <ExternalLink size={12} aria-hidden="true" /></a>}
    </div>
    {loading && <p className="panel-description" role="status">A calcular impacto…</p>}
    {error && <p className="ipam-alert error" role="alert">{error}</p>}
    {data && <>
      <div className="detail-grid impact-counts">
        <div><span>Vão abaixo</span><strong>{data.counts.down}</strong></div>
        <div><span>Ficam sem caminho</span><strong>{data.counts.affected}</strong></div>
        <div><span>Perdem uma alimentação</span><strong>{data.counts.powerDegraded}</strong></div>
        <div><span>Hosts / serviços</span><strong>{data.counts.hosts} / {data.counts.services}</strong></div>
        <div><span>Aplicações do Portal</span><strong>{data.counts.applications}</strong></div>
        <div><span>Ativos Tier 1</span><strong>{data.counts.tier1}</strong></div>
      </div>
      {data.truncated && <div className="ipam-alert warning" role="status" data-testid="impact-truncated"><strong>Pesquisa interrompida no limite de profundidade.</strong> <span>Podem existir mais equipamentos afetados para além do que é mostrado.</span> <span>Limite:</span> {data.maxDepth}</div>}
      {(data.anchorMode === 'largest-segment' || (data.anchorMode !== 'explicit' && !data.anchorDeviceIds.length)) && <div className="ipam-alert warning" role="status" data-testid="impact-no-gateway">Não há router nem firewall visível neste Site: os equipamentos sem caminho foram estimados em relação ao maior segmento de rede que resta.</div>}
      {data.hiddenCount > 0 && <p className="panel-description"><span>Equipamentos fora do teu âmbito (não mostrados):</span> {data.hiddenCount}</p>}
      {!total && <div className="change-empty-impact"><strong>Não foram encontrados equipamentos afetados nas ligações documentadas.</strong><span>Este resultado não confirma impacto zero.</span></div>}

      <Group title="Vão abaixo" count={data.down.length}><DeviceList devices={data.down} siteId={siteId} extra={(device) => <span className="state-badge reserved">{REASON_LABEL[(device as TopologyImpact['down'][number]).reason] ?? (device as TopologyImpact['down'][number]).reason}</span>} /></Group>
      <Group title="Ficam sem caminho" count={data.affected.length}><DeviceList devices={data.affected} siteId={siteId} extra={(device) => <span className="impact-meta"><span>saltos:</span> {(device as TopologyImpact['affected'][number]).hops}</span>} /></Group>
      <Group title="Perdem uma alimentação (continuam ligados)" count={data.powerDegraded.length}><DeviceList devices={data.powerDegraded} siteId={siteId} /></Group>
      <Group title="Hosts e serviços" count={data.hosts.length}>
        <ul className="device-360-list">{data.hosts.slice(0, LIST_LIMIT).map((host) => <li key={host.id}><strong>{host.name}</strong>{host.services.length ? <span className="impact-meta">{host.services.map((service) => `${service.name}${service.port ? `:${service.port}` : ''}`).join(', ')}</span> : <span className="impact-meta">Sem serviços</span>}</li>)}{data.hosts.length > LIST_LIMIT && <li className="impact-meta">+{data.hosts.length - LIST_LIMIT}</li>}</ul>
      </Group>
      <Group title="Aplicações do Portal" count={data.applications.length}>
        <ul className="device-360-list">{data.applications.map((app) => { const href = safeHref(app.url); return <li key={app.id}>{href ? <a href={href} target="_blank" rel="noreferrer">{app.name}</a> : <span data-testid="impact-unsafe-url">{app.name}</span>}<span className="impact-meta">{app.matchedHost}</span></li>; })}</ul>
      </Group>
      <Group title="Ativos críticos por tier" count={data.critical.T1.length + data.critical.T2.length + data.critical.T3.length + data.critical.untiered.length}>
        <dl className="device-360-facts impact-tiers">
          {([['T1', 'Tier 1'], ['T2', 'Tier 2'], ['T3', 'Tier 3'], ['untiered', 'Crítico sem tier']] as const).map(([key, label]) => data.critical[key].length ? <div key={key} className="impact-tier-row"><dt>{label}</dt><dd>{tier(data.critical[key]).map((item, index) => <span key={item.id}>{index ? ', ' : ''}<a href={deviceHref(item.id, siteId)}>{item.name}</a></span>)}</dd></div> : null)}
        </dl>
      </Group>
      <p className="change-muted impact-footnote">Calculado a partir das ligações e tomadas de PDU documentadas no inventário.</p>
    </>}
  </div>;
}

export interface ImpactDialogProps {
  title?: string;
  /** One or more things that can go down (e.g. the rack and each of its PDUs). */
  targets: Array<ImpactTarget & { label: string }>;
  siteId?: string | null;
  close: () => void;
}

/** "Impacto" dialog with a picker when several targets apply (rack view: the rack or one of its PDUs). */
export function ImpactDialog({ title = 'Impacto', targets, siteId, close }: ImpactDialogProps) {
  const [index, setIndex] = useState(0);
  const target = targets[index] ?? null;
  return <Modal title={title} close={close} className="impact-dialog">
    {targets.length > 1 && <label className="impact-target-picker"><span>O que vai abaixo</span><select className="context-toolbar-selector" value={index} onChange={(event) => setIndex(Number(event.target.value))}>{targets.map((item, position) => <option key={`${item.kind}:${item.id}`} value={position}>{item.label}</option>)}</select></label>}
    <ImpactPanel target={target ? { kind: target.kind, id: target.id } : null} siteId={siteId} />
  </Modal>;
}

/** Shortest documented path between two devices (Step 34). */
export function PathView({ devices, initialFrom = '', onResult }: { devices: Array<{ id: string; name: string }>; initialFrom?: string; onResult?: (path: TopologyPath | null) => void }) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState('');
  const [includeLogical, setIncludeLogical] = useState(false);
  const [state, setState] = useState<{ loading: boolean; data: TopologyPath | null; error: string }>({ loading: false, data: null, error: '' });
  useEffect(() => { if (initialFrom) setFrom(initialFrom); }, [initialFrom]);
  const run = async () => {
    if (!from || !to || from === to) return;
    setState({ loading: true, data: null, error: '' });
    try {
      const data = await getTopologyPath(from, to, { includeLogical });
      setState({ loading: false, data, error: '' }); onResult?.(data);
    } catch (reason) {
      setState({ loading: false, data: null, error: reason instanceof Error && reason.message ? reason.message : 'Não foi possível calcular o caminho.' }); onResult?.(null);
    }
  };
  const clear = () => { setState({ loading: false, data: null, error: '' }); onResult?.(null); };
  const path = state.data;
  return <div className="impact-path" data-testid="path-view">
    <label>Origem<select aria-label="Equipamento de origem do caminho" value={from} onChange={(event) => setFrom(event.target.value)}><option value="">Seleciona…</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label>
    <label>Destino<select aria-label="Equipamento de destino do caminho" value={to} onChange={(event) => setTo(event.target.value)}><option value="">Seleciona…</option>{devices.filter((device) => device.id !== from).map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label>
    <label className="impact-toggle"><input type="checkbox" checked={includeLogical} onChange={(event) => setIncludeLogical(event.target.checked)} /> <span>Incluir ligações lógicas</span></label>
    <div className="button-row"><button type="button" className="primary-button" disabled={!from || !to || from === to || state.loading} onClick={() => void run()}>{state.loading ? 'A calcular…' : 'Mostrar caminho'}</button>{(path || state.error) && <button type="button" className="secondary-button" onClick={clear}>Limpar caminho</button>}</div>
    {state.error && <p className="ipam-alert error" role="alert">{state.error}</p>}
    {path && !path.found && <p className="ipam-alert warning" role="status">{path.reason === 'DIFFERENT_SITES' ? 'Os dois equipamentos estão em Sites diferentes.' : 'Não há caminho documentado entre estes equipamentos dentro do limite de profundidade.'}</p>}
    {path?.found && <ol className="impact-path-steps" aria-label="Caminho documentado">
      {path.steps.map((step, index) => {
        const link = path.connections[index];
        return <li key={step.hidden ? `hidden-${index}` : step.id}>
          {step.hidden ? <em>Equipamento fora do teu âmbito</em> : <strong>{step.name}</strong>}
          {link && !link.hidden && (() => { const next = path.steps[index + 1]; const forward = !step.hidden ? link.sourceDeviceId === step.id : !(next && !next.hidden && link.sourceDeviceId === next.id); const local = forward ? link.sourceInterface : link.targetInterface; const remote = forward ? link.targetInterface : link.sourceInterface; return <small className="impact-meta">{local?.name ?? '—'} → {remote?.name ?? '—'}{link.label ? ` · ${link.label}` : ''}</small>; })()}
        </li>;
      })}
    </ol>}
    {path?.found && <p className="change-muted"><span>Saltos:</span> {path.hops}</p>}
  </div>;
}
