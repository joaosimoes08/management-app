'use client';

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type ToastKind = 'error' | 'warning' | 'success';

export type ToastInput = {
  kind: ToastKind;
  operation: string;
  message: string;
  /** Optional override, always clamped to the severity minimum. */
  duration?: number;
};

type Toast = ToastInput & { id: number; duration: number };

type ToastContextValue = {
  notify: (toast: ToastInput) => void;
  success: (operation: string, message: string, duration?: number) => void;
  warning: (operation: string, message: string, duration?: number) => void;
  error: (operation: string, message: string, duration?: number) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);
const minimumDuration: Record<ToastKind, number> = { error: 15_000, warning: 10_000, success: 5_000 };
const icons = { error: XCircle, warning: AlertTriangle, success: CheckCircle2 };
const labels = { error: 'Erro', warning: 'Atenção', success: 'Sucesso' };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const notify = useCallback((input: ToastInput) => {
    const duration = Math.max(input.duration ?? minimumDuration[input.kind], minimumDuration[input.kind]);
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { ...input, id, duration }]);
    window.setTimeout(() => dismiss(id), duration);
  }, [dismiss]);
  const make = useCallback((kind: ToastKind) => (operation: string, message: string, duration?: number) => notify({ kind, operation, message, duration }), [notify]);
  const value = useMemo(() => ({ notify, success: make('success'), warning: make('warning'), error: make('error'), dismiss }), [dismiss, make, notify]);

  return <ToastContext.Provider value={value}>
    {children}
    <div className="toast-region" aria-live="polite" aria-label="Notificações">
      {toasts.map((toast) => {
        const Icon = icons[toast.kind];
        return <article className={`toast toast-${toast.kind}`} key={toast.id} role={toast.kind === 'error' ? 'alert' : 'status'}>
          <div className="toast-icon"><Icon size={18} aria-hidden="true" /></div>
          <div className="toast-copy"><strong>{toast.operation}</strong><span>{toast.message}</span><small>{labels[toast.kind]}</small></div>
          <button className="toast-close" onClick={() => dismiss(toast.id)} aria-label="Fechar notificação"><X size={15} /></button>
          <i className="toast-progress" style={{ animationDuration: `${toast.duration}ms` }} />
        </article>;
      })}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast deve ser usado dentro de ToastProvider');
  return context;
}
