'use client';

import { useMemo, useRef, useState } from 'react';
import { Loader2, Search, Square, X } from 'lucide-react';
import { DataTable, sortByColumns, type DataTableColumn, type SortState } from '@/components/data-table';
import { formatDateTime, formatNumber } from '@/lib/format/date';
import { useUiText } from '@/components/ui/use-ui-text';
import { checkAllApplicationLinks, nextCheckAllCursor, type CheckAllCursor, type CheckAllItem } from './api';

/** Safety net: a batch holds up to 100 links, so 50 batches is far beyond any real catalogue. */
const MAX_BATCHES = 50;

type Outcome = { code: string; label: string; badge: string; rank: number };

const KNOWN: Record<string, Omit<Outcome, 'code'>> = {
  AVAILABLE: { label: 'Disponível', badge: 'occupied', rank: 4 },
  UNAVAILABLE: { label: 'Indisponível', badge: 'excluded', rank: 1 },
  UNREACHABLE: { label: 'Inacessível', badge: 'excluded', rank: 1 },
  BLOCKED: { label: 'Bloqueado', badge: 'reserved', rank: 2 },
  INVALID_URL: { label: 'URL inválido', badge: 'reserved', rank: 2 },
};

/** Per-link outcome: the API's code when there is one (BLOCKED, INVALID_URL, …), else available / unavailable. Unknown codes are shown as sent. */
export function checkOutcome(item: CheckAllItem): Outcome {
  const raw = item.code ?? item.result ?? item.status ?? (item.available ? 'AVAILABLE' : 'UNAVAILABLE');
  const code = String(raw).toUpperCase();
  const known = KNOWN[code];
  return known ? { code, ...known } : { code, label: code, badge: '', rank: 3 };
}

const messageOf = (error: unknown) => (error instanceof Error && error.message ? error.message : 'Não foi possível verificar as aplicações.');

export interface CheckAllPanelProps {
  /** Called after a run (complete, stopped or failed) so the catalogue reloads its availability. */
  onFinished: () => void;
  onBatch: (items: CheckAllItem[]) => void;
  close: () => void;
}

/** "Verificar todas": runs check-all batch after batch until the API reports nothing left, with per-link results. */
export function CheckAllPanel({ onFinished, onBatch, close }: CheckAllPanelProps) {
  const ui = useUiText();
  const [all, setAll] = useState(false);
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<CheckAllItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [finished, setFinished] = useState(false);
  const stopRef = useRef(false);
  const defaultSort: SortState = { column: 'result', direction: 'asc' };
  const [sort, setSort] = useState<SortState>(defaultSort);

  const run = async () => {
    stopRef.current = false;
    setRunning(true);
    setFinished(false);
    setError('');
    setItems([]);
    setTotal(null);
    let cursor: CheckAllCursor | null = {};
    try {
      for (let batch = 0; cursor && batch < MAX_BATCHES && !stopRef.current; batch += 1) {
        const result = await checkAllApplicationLinks(all, cursor);
        const received = Array.isArray(result.items) ? result.items : [];
        // A link checked again in a later batch keeps only its latest result.
        setItems((current) => [...current.filter((item) => !received.some((next) => next.id === item.id)), ...received]);
        if (typeof result.total === 'number') setTotal(result.total);
        onBatch(received);
        cursor = nextCheckAllCursor({ ...result, items: received }, cursor);
      }
      setFinished(true);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setRunning(false);
      onFinished();
    }
  };

  const counts = useMemo(() => {
    const byCode = new Map<string, { outcome: Outcome; count: number }>();
    for (const item of items) {
      const outcome = checkOutcome(item);
      const entry = byCode.get(outcome.code) ?? { outcome, count: 0 };
      entry.count += 1;
      byCode.set(outcome.code, entry);
    }
    return [...byCode.values()].sort((a, b) => a.outcome.rank - b.outcome.rank);
  }, [items]);

  const columns: DataTableColumn<CheckAllItem>[] = [
    { id: 'name', header: 'Aplicação', cell: (item) => <strong>{item.name}</strong>, sortValue: (item) => item.name },
    { id: 'result', header: 'Resultado', cell: (item) => { const outcome = checkOutcome(item); return <span className={`state-badge ${outcome.badge}`.trim()} data-code={outcome.code}><i />{outcome.label}</span>; }, sortValue: (item) => checkOutcome(item).rank },
    { id: 'http', header: 'HTTP', cell: (item) => (item.httpStatus ?? '—'), sortValue: (item) => item.httpStatus ?? null },
    { id: 'time', header: 'Tempo', cell: (item) => (typeof item.responseMs === 'number' ? `${formatNumber(item.responseMs)} ms` : '—'), sortValue: (item) => item.responseMs ?? null },
    { id: 'checkedAt', header: 'Verificado em', cell: (item) => (item.checkedAt ? formatDateTime(item.checkedAt) : '—'), sortValue: (item) => item.checkedAt ?? null },
    { id: 'message', header: 'Detalhe', cell: (item) => item.message || (checkOutcome(item).code === 'BLOCKED' ? 'O endereço de destino pertence a uma rede restrita.' : '—') },
  ];

  const progress = total !== null ? ui('portal.checkAll.progress', undefined, { done: items.length, total }) : ui('portal.checkAll.progressOpen', undefined, { done: items.length });
  return <section className="ipam-card" aria-labelledby="portal-check-all-title" data-testid="portal-check-all">
    <div className="panel-heading"><div><h2 id="portal-check-all-title">Verificar todas as aplicações</h2></div><button type="button" className="icon-button subtle" onClick={close} disabled={running} aria-label="Fechar"><X size={16} /></button></div>
    <div className="table-actions">
      <label>Âmbito <select value={all ? 'all' : 'checked'} disabled={running} onChange={(event) => setAll(event.target.value === 'all')}><option value="checked">Só com verificação de disponibilidade</option><option value="all">Todas as aplicações ativas</option></select></label>
      {running
        ? <button type="button" className="secondary-button" onClick={() => { stopRef.current = true; }}><Square size={14} /> Parar</button>
        : <button type="button" className="primary-button" onClick={() => void run()}><Search size={14} /> Iniciar verificação</button>}
      {(running || items.length > 0) && <span className="muted-cell" aria-live="polite">{running && <Loader2 className="spin" size={14} />} {progress}</span>}
    </div>
    {error && <div role="alert" className="ipam-alert error"><X size={15} />{error}</div>}
    {finished && !error && items.length === 0 && <div className="ipam-alert">Não há aplicações para verificar neste âmbito.</div>}
    {counts.length > 0 && <div className="table-actions" data-testid="portal-check-all-counts">{counts.map(({ outcome, count }) => <span key={outcome.code} className={`state-badge ${outcome.badge}`.trim()}><i />{`${outcome.label}: ${count}`}</span>)}</div>}
    {items.length > 0 && <DataTable rows={sortByColumns(items, columns, sort)} columns={columns} rowKey={(item) => item.id} label="Resultados da verificação" sort={sort} onSortChange={setSort} defaultSort={defaultSort} />}
  </section>;
}
