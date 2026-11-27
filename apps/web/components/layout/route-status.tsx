'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { useUiText } from '@/components/ui/use-ui-text';

/** Shown by app/(authenticated)/error.tsx inside the shell, so the sidebar and header stay usable after a page error. */
export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const ui = useUiText();
  useEffect(() => { console.error(error); }, [error]);
  return <div className="module-page route-error" role="alert"><div className="auth-card"><div className="auth-logo error"><AlertTriangle size={26} /></div><h1>{ui('app.error.title')}</h1><p>{ui('app.error.description')}</p><div className="auth-actions"><button className="primary-button" onClick={reset}><RefreshCw size={15} /> {ui('app.error.retry')}</button></div></div></div>;
}
