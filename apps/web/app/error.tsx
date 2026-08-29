'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <main className="auth-screen"><div className="auth-card"><div className="auth-logo error"><AlertTriangle size={26} /></div><span className="section-kicker">ERRO INESPERADO</span><h1>Algo falhou.</h1><p>Ocorreu um erro ao renderizar esta área. Tenta novamente; se persistir, recarrega a aplicação.</p><div className="auth-actions"><button className="primary-button" onClick={reset}><RefreshCw size={15} /> Tentar novamente</button></div></div></main>;
}
