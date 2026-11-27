'use client';

import { useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { CompactModal } from '@/components/ui/compact-modal';
import { useUiText } from '@/components/ui/use-ui-text';

/** Most ids the bulk-review endpoints accept per request (Descoberta and SNMP). */
export const BULK_REVIEW_MAX = 200;

/**
 * Per-item outcome returned by POST …/bulk-review. Kept loose on purpose: the
 * API may add fields or error codes, and unknown ones are shown generically.
 */
export type BulkReviewItemResult =
  | { id: string; ok: true; status?: string; [key: string]: unknown }
  | { id: string; ok: false; error?: { statusCode?: number; code?: string; message?: string | string[] } | null; [key: string]: unknown };

export type BulkReviewResponse = { status?: string; total?: number; succeeded?: number; failed?: number; items?: BulkReviewItemResult[] };

export type BulkReviewItem = { id: string; label: string; detail?: string };

/** Message for a failed item: API message first, then the code, then a generic text. */
export function bulkItemErrorMessage(result: BulkReviewItemResult, fallback = 'Não foi possível aplicar a revisão a este item.'): string {
  if (result.ok) return '';
  const message = result.error?.message;
  const text = Array.isArray(message) ? message.join(' ') : message;
  return text || result.error?.code || fallback;
}

type Props = {
  title: string;
  /** e.g. "Aprovar" / "Ignorar" — used on the submit button. */
  actionLabel: string;
  /** Plural noun for the summary line, e.g. "resultados". */
  noun: string;
  items: BulkReviewItem[];
  run: () => Promise<BulkReviewResponse>;
  /** Called once with the response so the caller can refresh its data. */
  onDone?: (response: BulkReviewResponse) => void;
  close: () => void;
};

/** Bulk approve/ignore with a per-item result list (same pattern as the Qualidade bulk dialog). */
export function BulkReviewDialog({ title, actionLabel, noun, items, run, onDone, close }: Props) {
  const ui = useUiText();
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<BulkReviewResponse | null>(null);
  const [error, setError] = useState('');
  const tooMany = items.length > BULK_REVIEW_MAX;
  const done = response !== null && !running;
  const byId = new Map((response?.items ?? []).map((item) => [item.id, item]));
  const labels = new Map(items.map((item) => [item.id, item]));
  // Items the API reported but the caller did not send (defensive: show them too).
  const extra: BulkReviewItem[] = (response?.items ?? []).filter((item) => !labels.has(item.id)).map((item) => ({ id: item.id, label: item.id }));
  const rows: BulkReviewItem[] = [...items, ...extra];
  const succeeded = response ? response.succeeded ?? (response.items ?? []).filter((item) => item.ok).length : 0;
  const total = response ? response.total ?? rows.length : items.length;

  const submit = async () => {
    setRunning(true);
    setError('');
    try {
      const result = await run();
      setResponse(result);
      onDone?.(result);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : ui('ui.bulk.requestFailed'));
    } finally {
      setRunning(false);
    }
  };

  return <CompactModal title={title} close={running ? () => undefined : close}><div className="modal-form">
    {!done && <p className="panel-description">{ui('ui.bulk.selected', undefined, { count: items.length, noun })}</p>}
    {tooMany && <div className="ipam-alert warning" role="note">{ui('ui.bulk.tooMany', undefined, { max: BULK_REVIEW_MAX })}</div>}
    {error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}
    {done && <div className={`ipam-alert ${succeeded === total ? 'success' : 'error'}`} role="status">{succeeded === total ? <CheckCircle2 size={15} /> : <X size={15} />}{ui('ui.bulk.applied', undefined, { succeeded, total })}</div>}
    <div className="ip-table-wrap" role="region" aria-label={ui('ui.bulkReviewItems')} tabIndex={0}><table className="ip-table">
      <thead><tr><th>{ui('ui.bulk.item')}</th><th>{ui('ui.bulk.result')}</th></tr></thead>
      <tbody>{rows.map((item) => {
        const result = byId.get(item.id);
        return <tr key={item.id}>
          <td><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</td>
          <td>{result
            ? result.ok
              ? <span className="state-badge occupied"><i />{typeof result.status === 'string' && result.status ? ui('ui.bulk.appliedStatus', undefined, { status: result.status }) : ui('ui.bulk.appliedPlain')}</span>
              : <><span className="state-badge excluded"><i />{ui('ui.bulk.failed')}</span><small>{bulkItemErrorMessage(result, ui('ui.bulk.itemFailed'))}</small></>
            : <span className="muted-cell">{running ? ui('ui.bulk.applying') : done ? ui('ui.bulk.noResponse') : ui('ui.bulk.pending')}</span>}</td>
        </tr>;
      })}</tbody>
    </table></div>
    <div className="modal-actions">{done
      ? <button type="button" className="primary-button" onClick={close}>{ui('ui.close')}</button>
      : <><button type="button" className="secondary-button" disabled={running} onClick={close}>{ui('ui.bulk.cancel')}</button><button type="button" className="primary-button" disabled={running || !items.length || tooMany} onClick={() => void submit()}>{running ? ui('ui.bulk.applying') : <>{actionLabel} {items.length}</>}</button></>}</div>
  </div></CompactModal>;
}
