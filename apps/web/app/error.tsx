'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { useUiText } from '@/components/ui/use-ui-text';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const ui = useUiText();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <main className="auth-screen"><div className="auth-card"><div className="auth-logo error"><AlertTriangle size={26} /></div><h1>{ui('app.error.title')}</h1><p>{ui('app.error.description')}</p><div className="auth-actions"><button className="primary-button" onClick={reset}><RefreshCw size={15} /> {ui('app.error.retry')}</button></div></div></main>;
}
