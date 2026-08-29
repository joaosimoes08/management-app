'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Calculator } from 'lucide-react';
import type { CalculatorInput, CalculatorResult } from '../types';
import { ipv4Mask, isValidIpv4 } from '../utils';

export interface CalculatorViewProps {
  calc: CalculatorInput;
  setCalc: (calc: CalculatorInput) => void;
  result: CalculatorResult | null;
  onSubmit: (event: FormEvent) => void;
}

const subnetPageSize = 16;

/** IPv4 subnetting calculator (/0 to /32 split view). */
export function CalculatorView({ calc, setCalc, result, onSubmit }: CalculatorViewProps) {
  const [page, setPage] = useState(1);
  const [addressError, setAddressError] = useState('');
  const subnets = result?.subnets ?? [];
  const totalPages = Math.max(1, Math.ceil(subnets.length / subnetPageSize));
  useEffect(() => setPage(1), [result]);
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * subnetPageSize;
  const visibleSubnets = subnets.slice(start, start + subnetPageSize);
  const pageNumbers = Array.from(new Set([1, totalPages, ...Array.from({ length: 5 }, (_, i) => currentPage - 2 + i).filter((n) => n > 1 && n < totalPages)])).sort((a, b) => a - b);

  const submit = (event: FormEvent) => {
    if (!isValidIpv4(calc.address)) {
      event.preventDefault();
      setAddressError('Indica um IPv4 válido, por exemplo 10.80.80.0.');
      return;
    }
    setAddressError('');
    onSubmit(event);
  };

  return <section className="ipam-card calculator-panel">
    <div className="panel-heading"><div><span className="section-kicker">SUBNETTING</span><h2>Calculadora de subnets IPv4</h2><p className="panel-description">Escolhe a subnet, a máscara base e a máscara destino. Suporta /0 a /32.</p></div><Calculator size={18} /></div>
    <form className="calculator-form" onSubmit={submit}>
      <label>Subnet em questão<input required maxLength={15} inputMode="numeric" pattern="[0-9.]+" placeholder="10.80.80.0" value={calc.address} onChange={(event) => {
        const address = event.target.value.replace(/[^0-9.]/g, '').slice(0, 15);
        setAddressError('');
        setCalc({ ...calc, address });
      }} aria-invalid={Boolean(addressError)} /><small>Apenas números e pontos · máximo 15 caracteres.</small>{addressError && <small className="calculator-field-error" role="alert">{addressError}</small>}</label>
      <label>Máscara base<select value={calc.basePrefix} onChange={(event) => {
        const basePrefix = event.target.value;
        setCalc({ ...calc, basePrefix, newPrefix: Number(calc.newPrefix) < Number(basePrefix) ? basePrefix : calc.newPrefix });
      }}>{Array.from({ length: 33 }, (_, i) => i).map((prefix) => <option key={prefix} value={prefix}>/{prefix} ({ipv4Mask(prefix)})</option>)}</select></label>
      <label>Máscara destino<select value={calc.newPrefix} onChange={(event) => setCalc({ ...calc, newPrefix: event.target.value })}>{Array.from({ length: 33 }, (_, i) => i).filter((prefix) => prefix >= Number(calc.basePrefix)).map((prefix) => <option key={prefix} value={prefix}>/{prefix} ({ipv4Mask(prefix)})</option>)}</select></label>
      <button className="primary-button"><Calculator size={14} /> Calcular subnets</button>
    </form>
    {result && <div className="calculator-summary"><strong>{result.subnetCount} subnets /{result.newPrefix}</strong><span>Rede base normalizada: <code>{result.parent}</code></span></div>}
    {subnets.length > 0 && <>
      <div className="subnet-results" role="list" aria-label="Subnets calculadas">{visibleSubnets.map((subnet) => <article className="calculated-subnet" key={subnet.cidr} role="listitem"><div className="calculated-subnet-number">{subnet.number}</div><div className="calculated-subnet-content"><strong><code>{subnet.cidr}</code></strong><div><span>IPs utilizáveis</span><code>{subnet.usableRange}</code></div><div><span>Broadcast IP</span><code>{subnet.broadcast}</code></div></div></article>)}</div>
      <nav className="calculator-pagination" aria-label="Páginas das subnets"><span>{start + 1}-{Math.min(start + subnetPageSize, subnets.length)} de {subnets.length}</span><div className="calculator-page-buttons"><button type="button" aria-label="Página anterior" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>‹</button>{pageNumbers.map((number, index) => <span key={number}>{index > 0 && number - pageNumbers[index - 1] > 1 && <em>…</em>}<button type="button" className={number === currentPage ? 'active' : ''} aria-current={number === currentPage ? 'page' : undefined} onClick={() => setPage(number)}>{number}</button></span>)}<button type="button" aria-label="Página seguinte" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>›</button></div></nav>
    </>}
  </section>;
}
