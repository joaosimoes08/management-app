'use client';

import Link from 'next/link';
import { useUiText } from '@/components/ui/use-ui-text';

export default function NotFound() {
  const ui = useUiText();
  return (
    <main style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <h1>404</h1>
        <p>{ui('app.notFound.description')}</p>
        <Link href="/" className="primary-button">{ui('app.notFound.back')}</Link>
      </div>
    </main>
  );
}
