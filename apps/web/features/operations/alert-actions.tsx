'use client';

/**
 * Acting on operational alerts: the row buttons (Reconhecer, Adiar 1/4/24 h, Resolver with a
 * confirmation), the bulk bar for the selection, and the read-only note. Every action goes
 * through POST /operations/alerts/bulk so one alert or many report the same way.
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, Clock3, Info, X } from 'lucide-react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatDateTime } from '@/lib/format/date';
import { bulkOperationalAlerts, BULK_ALERT_LIMIT, type BulkAlertAction, type BulkAlertResponse } from './api';
import { SNOOZE_CHOICES } from './alert-meta';
import { useUiText } from '@/components/ui/use-ui-text';

export const OPERATOR_ROLES = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR'] as const;

type Actionable = { id: string; title: string; status: string; siteId?: string | null };

/** Unresolved alerts are actionable; global alerts (no Site) only for ADMIN, as the API enforces. */
export const isAlertActionable = (alert: Actionable, isAdmin: boolean) => alert.status !== 'RESOLVED' && (Boolean(alert.siteId) || isAdmin);

export type AlertActionOutcome = { action: BulkAlertAction; succeeded: number; failed: number; snoozedUntil?: string; failures: Array<{ title: string; message: string }> };

const failureMessages: Record<string, string> = {
  NOT_FOUND: 'Alerta não encontrado ou sem acesso.',
  FORBIDDEN: 'Sem permissão para alterar este alerta.',
  INVALID: 'Pedido inválido.',
  ERROR: 'Erro inesperado.',
};

export function alertOutcome(response: BulkAlertResponse, titles: ReadonlyMap<string, string>): AlertActionOutcome {
  return {
    action: response.action,
    succeeded: response.succeeded,
    failed: response.failed,
    snoozedUntil: response.snoozedUntil,
    failures: response.results.flatMap((item) => item.ok ? [] : [{ title: titles.get(item.id) ?? item.id, message: item.message || failureMessages[item.code] || failureMessages.ERROR }]),
  };
}

const doneLabels: Record<BulkAlertAction, [string, string]> = {
  ACKNOWLEDGE: ['alerta reconhecido', 'alertas reconhecidos'],
  SNOOZE: ['alerta adiado', 'alertas adiados'],
  RESOLVE: ['alerta resolvido', 'alertas resolvidos'],
};

/** "3 alertas adiados até 23/11/2026, 15:00. 1 falhou: …" */
export function outcomeText(outcome: AlertActionOutcome): string {
  const [one, many] = doneLabels[outcome.action];
  const parts = [`${outcome.succeeded} ${outcome.succeeded === 1 ? one : many}`];
  if (outcome.snoozedUntil && outcome.succeeded) parts[0] += ` até ${formatDateTime(outcome.snoozedUntil, { dateStyle: 'short', timeStyle: 'short' })}`;
  let text = `${parts[0]}.`;
  if (outcome.failed) text += ` ${outcome.failed} ${outcome.failed === 1 ? 'falhou' : 'falharam'}: ${outcome.failures.map((item) => `${item.title} (${item.message})`).join('; ')}`;
  return text;
}

/**
 * Runs an action on alerts (after confirming Resolver), refreshes every operations query and
 * reports the outcome. Render `confirmDialog` once.
 */
export function useAlertActions(onDone?: (outcome: AlertActionOutcome, ids: string[]) => void) {
  const tx = useUiText();
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<AlertActionOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (action: BulkAlertAction, alerts: readonly Actionable[], durationHours?: number) => {
    const targets = alerts.slice(0, BULK_ALERT_LIMIT);
    if (!targets.length) return;
    if (action === 'RESOLVE') {
      const message = targets.length === 1
        ? tx('groupB.alerts.resolveOne', undefined, { title: targets[0].title })
        : tx('groupB.alerts.resolveMany', undefined, { count: targets.length });
      if (!await confirm({ title: 'Resolver alertas', message, confirmLabel: 'Resolver' })) return;
    }
    setRunning(true); setError(null); setOutcome(null);
    try {
      const ids = targets.map((alert) => alert.id);
      const response = await bulkOperationalAlerts({ action, ids, ...(action === 'SNOOZE' ? { durationHours: durationHours ?? 1 } : {}) });
      const result = alertOutcome(response, new Map(targets.map((alert) => [alert.id, alert.title])));
      setOutcome(result);
      onDone?.(result, response.results.filter((item) => item.ok).map((item) => item.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível aplicar a ação.');
    } finally {
      setRunning(false);
      await queryClient.invalidateQueries({ queryKey: ['operations'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    }
  }, [confirm, onDone, queryClient, tx]);
  const clear = useCallback(() => { setOutcome(null); setError(null); }, []);
  return { run, running, outcome, error, clear, confirmDialog };
}

/** Banner with the last action's outcome or error. */
export function AlertActionStatus({ outcome, error, onClose }: { outcome: AlertActionOutcome | null; error: string | null; onClose: () => void }) {
  if (!outcome && !error) return null;
  const ok = !error && outcome !== null && outcome.failed === 0;
  return <div className={`ipam-alert ${ok ? 'success' : 'error'} alert-action-status`} role={ok ? 'status' : 'alert'}>
    {ok ? <CheckCircle2 size={15} /> : <X size={15} />}<span>{error ?? (outcome ? outcomeText(outcome) : '')}</span>
    <button type="button" className="icon-button subtle" onClick={onClose} aria-label="Fechar mensagem"><X size={13} /></button>
  </div>;
}

/** Adiar as a native select: one choice snoozes at once, then the select resets. */
export function SnoozeSelect({ label, disabled, onPick, compact = false }: { label: string; disabled?: boolean; onPick: (hours: number) => void; compact?: boolean }) {
  return <label className={`snooze-select${compact ? ' compact' : ''}`} title={label}>
    <Clock3 size={13} aria-hidden="true" />
    <select aria-label={label} value="" disabled={disabled} onChange={(event) => { const hours = Number(event.target.value); if (hours) onPick(hours); }}>
      <option value="">Adiar…</option>
      {SNOOZE_CHOICES.map((choice) => <option key={choice.hours} value={choice.hours}>{choice.label}</option>)}
    </select>
  </label>;
}

/** Reconhecer / Adiar / Resolver for one alert. Reconhecer hides once acknowledged. */
export function AlertRowActions({ alert, disabled, run }: { alert: Actionable; disabled?: boolean; run: (action: BulkAlertAction, alerts: Actionable[], hours?: number) => void }) {
  return <span className="button-row alert-row-actions">
    {alert.status === 'OPEN' && <button type="button" className="secondary-button" disabled={disabled} onClick={() => run('ACKNOWLEDGE', [alert])} aria-label={`Reconhecer ${alert.title}`}>Reconhecer</button>}
    <SnoozeSelect label={`Adiar ${alert.title}`} disabled={disabled} onPick={(hours) => run('SNOOZE', [alert], hours)} />
    <button type="button" className="secondary-button" disabled={disabled} onClick={() => run('RESOLVE', [alert])} aria-label={`Resolver ${alert.title}`}><Check size={13} /> Resolver</button>
  </span>;
}

/** Shown when the selection is not empty. */
export function AlertBulkBar({ selected, disabled, run, clearSelection }: { selected: Actionable[]; disabled?: boolean; run: (action: BulkAlertAction, alerts: Actionable[], hours?: number) => void; clearSelection: () => void }) {
  const tx = useUiText();
  if (!selected.length) return null;
  const over = selected.length > BULK_ALERT_LIMIT;
  return <div className="alert-bulk-bar" role="region" aria-label="Ações sobre os alertas selecionados">
    <strong>{selected.length === 1 ? '1 alerta selecionado' : `${selected.length} alertas selecionados`}</strong>
    {over && <small>{tx('groupB.alerts.bulkLimit', undefined, { count: BULK_ALERT_LIMIT })}</small>}
    <span className="button-row">
      <button type="button" className="secondary-button" disabled={disabled} onClick={() => run('ACKNOWLEDGE', selected)}>Reconhecer</button>
      <SnoozeSelect label="Adiar selecionados" disabled={disabled} onPick={(hours) => run('SNOOZE', selected, hours)} />
      <button type="button" className="secondary-button" disabled={disabled} onClick={() => run('RESOLVE', selected)}><Check size={13} /> Resolver</button>
      <button type="button" className="text-button" disabled={disabled} onClick={clearSelection}>Limpar seleção</button>
    </span>
  </div>;
}

/** Why a read-only user sees no action buttons. */
export function ReadOnlyAlertNote() {
  return <p className="panel-description alert-readonly-note" role="note"><Info size={13} aria-hidden="true" /> Tens acesso só de leitura: reconhecer, adiar e resolver alertas cabe aos operadores (ADMIN, NETWORK_OPERATOR ou SYSTEMS_OPERATOR).</p>;
}
