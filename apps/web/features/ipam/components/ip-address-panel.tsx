'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Activity, Edit3, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { checkIpAddress, getIpCheckHistory, updateIpAddress, type IpCheckHistoryEntry } from '../api';
import type { IpAddressRow } from '../types';

interface IpAddressPanelProps {
  ip: IpAddressRow;
  canUpdate: boolean;
  canCheck: boolean;
  close: () => void;
  updated: (ip: IpAddressRow) => void;
  saved: () => void;
  error: (message: string) => void;
}

export function IpAddressPanel({ ip, canUpdate, canCheck, close, updated, saved, error }: IpAddressPanelProps) {
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState(ip.address);
  const [hostname, setHostname] = useState(ip.hostname ?? '');
  const [notes, setNotes] = useState(ip.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<IpCheckHistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

  const loadHistory = async (requestedPage = page) => {
    setHistoryError('');
    try {
      const result = await getIpCheckHistory(ip.id, requestedPage);
      setHistory(result.items);
      setTotalPages(result.totalPages);
      setPage(requestedPage);
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : 'Não foi possível carregar o histórico.');
    }
  };
  useEffect(() => { void loadHistory(1); }, [ip.id]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await updateIpAddress(ip.id, { address, hostname: hostname || undefined, notes: notes || undefined });
      updated(result);
      saved();
      setEditing(false);
    } catch (cause) {
      error(cause instanceof Error ? cause.message : 'Não foi possível guardar o endereço IP.');
    } finally { setBusy(false); }
  };

  const check = async () => {
    setBusy(true);
    try {
      const result = await checkIpAddress(ip.id);
      updated({ ...ip, ...result });
      await loadHistory(1);
    } catch (cause) {
      error(cause instanceof Error ? cause.message : 'Não foi possível verificar o endereço IP.');
    } finally { setBusy(false); }
  };

  return <>
    <button className="ip-panel-backdrop" aria-label="Fechar detalhes do IP" onClick={close} />
    <aside className="host-panel ip-address-panel" role="dialog" aria-modal="true" aria-labelledby="ip-panel-title">
      <div className="host-panel-head"><div><span className="section-kicker">ENDEREÇO IP</span><h2 id="ip-panel-title">{ip.address}</h2><span>{ip.hostname || 'Sem hostname'}</span></div><button className="icon-button" onClick={close} aria-label="Fechar"><X size={18} /></button></div>
      <div className="host-status-line"><span>Estado: <strong>{ip.state}</strong></span><span>Observado: <strong>{ip.observedState || '—'}</strong></span><span>Subnet: <strong>{ip.subnet?.cidr || ip.subnetId}</strong></span></div>
      {editing ? <form className="modal-form host-edit-form" onSubmit={save}>
        <label>Endereço IP<input required value={address} onChange={(event) => setAddress(event.target.value)} /></label>
        <label>Hostname<input value={hostname} onChange={(event) => setHostname(event.target.value)} /></label>
        <label>Descrição<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setEditing(false)}>Cancelar</button><button className="primary-button" disabled={busy}>{busy && <LoaderCircle size={14} className="spin" />} Guardar</button></div>
      </form> : <>
        <div className="host-detail-grid"><div><span>MAC</span><strong>{ip.macAddress || '—'}</strong></div><div><span>Última verificação</span><strong>{ip.lastCheckAt ? new Date(ip.lastCheckAt).toLocaleString('pt-PT') : 'Nunca'}</strong></div><div className="wide"><span>Descrição</span><strong>{ip.notes || '—'}</strong></div><div className="wide"><span>Associado a</span><strong>{ip.host?.name || ip.interface?.device?.name || 'Sem host ou equipamento associado'}</strong></div></div>
        <div className="form-actions ip-panel-actions">{canUpdate && <button className="secondary-button" onClick={() => setEditing(true)}><Edit3 size={14} /> Editar IP</button>}{canCheck && <button className="primary-button" disabled={busy} onClick={() => void check()}>{busy ? <LoaderCircle size={14} className="spin" /> : <Activity size={14} />} Verificar IP</button>}</div>
      </>}
      <section className="ip-check-history" aria-labelledby="ip-history-title">
        <div className="panel-heading"><div><span className="section-kicker">TCP · PORTA 443</span><h3 id="ip-history-title">Histórico de verificações</h3></div><button className="icon-button subtle" onClick={() => void loadHistory(1)} aria-label="Atualizar histórico"><RefreshCw size={14} /></button></div>
        {historyError && <p className="ipam-alert error" role="alert">{historyError}</p>}
        {!history && !historyError && <p className="ip-history-muted">A carregar histórico…</p>}
        {history?.length === 0 && <p className="ip-history-muted">Ainda não existem verificações registadas.</p>}
        {history && history.length > 0 && <>
          <ol className="ip-check-list">{history.map((entry) => <li key={entry.id}><span className={`ip-check-dot ${entry.metadata?.reachable ? 'reachable' : 'unreachable'}`} /><span><strong>{entry.metadata?.reachable ? 'Acessível' : 'Sem resposta'}</strong><small>{entry.user?.displayName || entry.user?.username || 'Sistema'}</small></span><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString('pt-PT')}</time></li>)}</ol>
          {totalPages > 1 && <div className="ip-history-pagination"><button className="secondary-button" disabled={page <= 1} onClick={() => void loadHistory(page - 1)}>Anterior</button><span>{page} / {totalPages}</span><button className="secondary-button" disabled={page >= totalPages} onClick={() => void loadHistory(page + 1)}>Seguinte</button></div>}
        </>}
      </section>
    </aside>
  </>;
}
