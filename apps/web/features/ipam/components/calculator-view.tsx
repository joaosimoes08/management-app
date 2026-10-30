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

/** IPv4 splitting and non-enumerating IPv4/IPv6 CIDR tools. */
export function CalculatorView({ calc, setCalc, result, onSubmit }: CalculatorViewProps) {
  const [page, setPage] = useState(1);
  const [addressError, setAddressError] = useState('');
  const subnets = result && 'subnets' in result ? result.subnets : [];
  const totalPages = Math.max(1, Math.ceil(subnets.length / subnetPageSize));
  useEffect(() => setPage(1), [result]);
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * subnetPageSize;
  const visibleSubnets = subnets.slice(start, start + subnetPageSize);
  const pageNumbers = Array.from(new Set([1, totalPages, ...Array.from({ length: 5 }, (_, i) => currentPage - 2 + i).filter((n) => n > 1 && n < totalPages)])).sort((a, b) => a - b);

  const submit = (event: FormEvent) => {
    if ((calc.operation ?? 'split') === 'split' && !isValidIpv4(calc.address)) {
      event.preventDefault();
      setAddressError('Indica um IPv4 válido, por exemplo 10.80.80.0.');
      return;
    }
    if ((calc.operation ?? 'split') !== 'split' && !calc.cidr?.trim()) {
      event.preventDefault();
      setAddressError('Indica uma subnet CIDR IPv4 ou IPv6.');
      return;
    }
    if (calc.operation === 'overlap' && !(calc.cidrsText ?? '').split(/[\n,;]+/).some((cidr) => cidr.trim())) {
      event.preventDefault();
      setAddressError('Indica pelo menos uma subnet para comparar.');
      return;
    }
    setAddressError('');
    onSubmit(event);
  };

  const operation = calc.operation ?? 'split';
  const splitResult = result && 'subnets' in result ? result : null;
  const summaryResult = result && 'version' in result ? result : null;
  const containsResult = result && 'contains' in result ? result : null;
  const overlapResult = result && 'overlaps' in result ? result : null;

  return <section className="ipam-card calculator-panel">
    <div className="panel-heading"><div><span className="section-kicker">SUBNETTING</span><h2>Calculadora CIDR IPv4 e IPv6</h2><p className="panel-description">Consulta subnets IPv4 e IPv6 sem enumerar endereços. A divisão em subnets continua disponível para IPv4.</p></div><Calculator size={18} /></div>
    <form className="calculator-form" onSubmit={submit}>
      <label>Operação<select value={operation} onChange={(event) => { setAddressError(''); setCalc({ ...calc, operation: event.target.value as NonNullable<CalculatorInput['operation']> }); }}><option value="split">Dividir subnet IPv4</option><option value="summary">Resumo IPv4/IPv6</option><option value="contains">Verificar endereço</option><option value="overlap">Verificar sobreposição</option></select></label>
      {operation === 'split' ? <>
        <label>Subnet em questão<input required maxLength={15} inputMode="numeric" pattern="[0-9.]+" placeholder="10.80.80.0" value={calc.address} onChange={(event) => {
          const address = event.target.value.replace(/[^0-9.]/g, '').slice(0, 15);
          setAddressError('');
          setCalc({ ...calc, address });
        }} aria-invalid={Boolean(addressError)} /><small>Apenas números e pontos · máximo 15 caracteres.</small></label>
        <label>Máscara base<select value={calc.basePrefix} onChange={(event) => {
          const basePrefix = event.target.value;
          setCalc({ ...calc, basePrefix, newPrefix: Number(calc.newPrefix) < Number(basePrefix) ? basePrefix : calc.newPrefix });
        }}>{Array.from({ length: 33 }, (_, i) => i).map((prefix) => <option key={prefix} value={prefix}>/{prefix} ({ipv4Mask(prefix)})</option>)}</select></label>
        <label>Máscara destino<select value={calc.newPrefix} onChange={(event) => setCalc({ ...calc, newPrefix: event.target.value })}>{Array.from({ length: 33 }, (_, i) => i).filter((prefix) => prefix >= Number(calc.basePrefix)).map((prefix) => <option key={prefix} value={prefix}>/{prefix} ({ipv4Mask(prefix)})</option>)}</select></label>
      </> : <>
        <label>Subnet CIDR<input required maxLength={43} placeholder="2001:db8:1234::/48" value={calc.cidr ?? ''} onChange={(event) => { setAddressError(''); setCalc({ ...calc, cidr: event.target.value }); }} aria-invalid={Boolean(addressError)} /></label>
        {operation === 'contains' && <label>Endereço a verificar<input required maxLength={39} placeholder="2001:db8:1234::1" value={calc.containsAddress ?? ''} onChange={(event) => setCalc({ ...calc, containsAddress: event.target.value })} /></label>}
        {operation === 'overlap' && <label>Outras subnets CIDR<input required maxLength={1000} placeholder="2001:db8:1234:1::/64, 2001:db8:ffff::/48" value={calc.cidrsText ?? ''} onChange={(event) => setCalc({ ...calc, cidrsText: event.target.value })} /><small>Separa as subnets por vírgulas ou linhas.</small></label>}
      </>}
      {addressError && <small className="calculator-field-error" role="alert">{addressError}</small>}
      <button className="primary-button"><Calculator size={14} /> Calcular</button>
    </form>
    {splitResult && <div className="calculator-summary"><strong>{splitResult.subnetCount} subnets /{splitResult.newPrefix}</strong><span>Rede base normalizada: <code>{splitResult.parent}</code></span></div>}
    {summaryResult && <div className="calculator-summary"><strong>IPv{summaryResult.version} · {summaryResult.cidr}</strong><span>Capacidade total: <code>{summaryResult.total?.toLocaleString?.() ?? summaryResult.total ?? 'não calculada'}</code></span><span>Primeiro endereço: <code>{summaryResult.firstUsable}</code></span><span>Último endereço: <code>{summaryResult.lastUsable}</code></span>{summaryResult.broadcast && <span>Broadcast: <code>{summaryResult.broadcast}</code></span>}</div>}
    {containsResult && <div className="calculator-summary"><strong>{containsResult.address} {containsResult.contains ? 'pertence' : 'não pertence'} a {containsResult.cidr}</strong></div>}
    {overlapResult && <div className="calculator-summary"><strong>{overlapResult.overlaps.length ? 'Subnets sobrepostas' : 'Sem sobreposição'}</strong>{overlapResult.overlaps.map((cidr) => <span key={cidr}><code>{cidr}</code></span>)}</div>}
    {splitResult && subnets.length > 0 && <>
      <div className="subnet-results" role="list" aria-label="Subnets calculadas">{visibleSubnets.map((subnet) => <article className="calculated-subnet" key={subnet.cidr} role="listitem"><div className="calculated-subnet-number">{subnet.number}</div><div className="calculated-subnet-content"><strong><code>{subnet.cidr}</code></strong><div><span>IPs utilizáveis</span><code>{subnet.usableRange}</code></div><div><span>Broadcast IP</span><code>{subnet.broadcast}</code></div></div></article>)}</div>
      <nav className="calculator-pagination" aria-label="Páginas das subnets"><span>{start + 1}-{Math.min(start + subnetPageSize, subnets.length)} de {subnets.length}</span><div className="calculator-page-buttons"><button type="button" aria-label="Página anterior" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>‹</button>{pageNumbers.map((number, index) => <span key={number}>{index > 0 && number - pageNumbers[index - 1] > 1 && <em>…</em>}<button type="button" className={number === currentPage ? 'active' : ''} aria-current={number === currentPage ? 'page' : undefined} onClick={() => setPage(number)}>{number}</button></span>)}<button type="button" aria-label="Página seguinte" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>›</button></div></nav>
    </>}
  </section>;
}
