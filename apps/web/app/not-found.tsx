import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <h1>404</h1>
        <p>A página que procuras não existe.</p>
        <Link href="/" className="primary-button">Voltar ao dashboard</Link>
      </div>
    </main>
  );
}
