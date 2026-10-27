'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Clock3, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useSiteContext } from '@/lib/site-context';
import { acknowledgeOperationalAlert, getInventoryQuality, listOperationalAlerts, readAllOperationalAlerts, resolveOperationalAlert, snoozeOperationalAlert, type InventoryQuality, type OperationalAlert } from './api';
import { useOperationalEvents } from './use-operational-events';

export function OperationsPanel({ showAlerts = true, showQuality = true }: { showAlerts?: boolean; showQuality?: boolean }) {
  const { siteId } = useSiteContext(); const { hasRole } = useAuth(); const [alerts, setAlerts] = useState<OperationalAlert[]>([]); const [quality, setQuality] = useState<InventoryQuality>(); const canEdit = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR') || hasRole('SYSTEMS_OPERATOR');
  const load = useCallback(async () => { const [nextAlerts, nextQuality] = await Promise.all([listOperationalAlerts(siteId || undefined), getInventoryQuality(siteId || undefined)]); setAlerts(nextAlerts.items ?? []); setQuality(nextQuality); }, [siteId]);
  useEffect(() => { void load(); }, [load]);
  useOperationalEvents({ fallback: load, onEvent: (event) => { if (event.event !== 'heartbeat') void load(); } });
  const act = async (fn: () => Promise<unknown>) => { await fn(); await load(); };
  return <section className="content-grid" aria-label="Operações">{showAlerts && <article className="panel"><div className="panel-heading"><div><span className="section-kicker">OPERAÇÕES</span><h2>Alertas ativos</h2></div><button className="icon-button subtle" onClick={() => void load()} aria-label="Atualizar alertas"><RefreshCw size={16} /></button></div>{alerts.length ? <div className="alert-list">{alerts.map((alert) => <div className={`alert-row ${alert.severity.toLowerCase()}`} key={alert.id}><AlertTriangle size={15} /><span><strong>{alert.title}</strong><small>{alert.detail ?? 'Requer atenção operacional.'}</small></span>{canEdit && <span className="button-row"><button className="secondary-button" onClick={() => void act(() => acknowledgeOperationalAlert(alert.id))}>Reconhecer</button><button className="secondary-button" onClick={() => void act(() => snoozeOperationalAlert(alert.id))}><Clock3 size={13} /> Adiar</button><button className="secondary-button" onClick={() => void act(() => resolveOperationalAlert(alert.id))}><Check size={13} /> Resolver</button></span>}</div>)}</div> : <div className="no-data">Sem alertas ativos.</div>}{alerts.length > 0 && <button className="text-button" onClick={() => void readAllOperationalAlerts().then(() => load())}>Marcar tudo como lido</button>}</article>}{showQuality && <InventoryQualityCard quality={quality} />}</section>;
}

export function InventoryQualityCard({ quality }: { quality?: InventoryQuality }) { return <article className="panel"><div className="panel-heading"><div><span className="section-kicker">INVENTÁRIO</span><h2>Qualidade dos dados</h2></div><a className="text-button" href="/qualidade-inventario">Abrir fila</a></div><div className="health-score"><div className="score-ring"><span>{quality?.score ?? '—'}<span>{quality?.score === undefined ? '' : '%'}</span></span></div><div><strong>{quality?.validDeviceCount ?? quality?.valid ?? 0} dispositivos sem problemas</strong><p>{quality?.affectedDeviceCount ?? quality?.invalid ?? 0} dispositivos afetados · {quality?.staleFindingCount ?? quality?.stale ?? 0} findings desatualizados</p></div></div></article>; }
