'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Calculator } from 'lucide-react';
import type { CalculatorInput, CalculatorResult, CalculatorOperation } from '../types';
import { ipv4Mask, isValidCidr, isValidIpAddress, isValidIpv4 } from '../utils';

export interface CalculatorViewProps {
  calc: CalculatorInput;
  setCalc: (calc: CalculatorInput) => void;
  result: CalculatorResult | null;
  clearResult: () => void;
  pending: boolean;
  onSubmit: (event: FormEvent) => void;
}

const subnetPageSize = 16;

/** IPv4 splitting and non-enumerating IPv4/IPv6 CIDR tools. */
export function CalculatorView({ calc, setCalc, result, clearResult, pending, onSubmit }: CalculatorViewProps) {
  const [page, setPage] = useState(1);
  const [fieldErrors, setFieldErrors] = useState<{ subnet?: string; cidr?: string; address?: string; candidates?: string }>({});
  const subnets = result && 'subnets' in result ? result.subnets : [];
  const totalPages = Math.max(1, Math.ceil(subnets.length / subnetPageSize));
  useEffect(() => setPage(1), [result]);
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * subnetPageSize;
  const visibleSubnets = subnets.slice(start, start + subnetPageSize);
  const pageNumbers = Array.from(new Set([1, totalPages, ...Array.from({ length: 5 }, (_, i) => currentPage - 2 + i).filter((n) => n > 1 && n < totalPages)])).sort((a, b) => a - b);
  const operation = calc.operation ?? 'split';

  const updateCalc = (patch: Partial<CalculatorInput>) => {
    clearResult();
    setCalc({ ...calc, ...patch });
  };

  const submit = (event: FormEvent) => {
    const errors: typeof fieldErrors = {};
    if (operation === 'split' && !isValidIpv4(calc.address)) errors.subnet = 'Indica um IPv4 válido, por exemplo 10.80.80.0.';
    if (operation !== 'split' && !isValidCidr(calc.cidr ?? '')) errors.cidr = 'Indica uma subnet CIDR IPv4 ou IPv6 válida.';
    if (operation === 'contains' && !isValidIpAddress(calc.containsAddress ?? '')) errors.address = 'Indica um endereço IPv4 ou IPv6 válido.';
    if (operation === 'overlap') {
      const candidates = (calc.cidrsText ?? '').split(/[\n,;]+/).map((cidr) => cidr.trim()).filter(Boolean);
      if (!candidates.length) errors.candidates = 'Indica pelo menos uma subnet para comparar.';
      else if (candidates.some((cidr) => !isValidCidr(cidr))) errors.candidates = 'Verifica o formato CIDR de cada subnet.';
    }
    if (Object.keys(errors).length) {
      event.preventDefault();
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    onSubmit(event);
  };

  const splitResult = result && 'subnets' in result ? result : null;
  const summaryResult = result && 'version' in result ? result : null;
  const containsResult = result && 'contains' in result ? result : null;
  const overlapResult = result && 'overlaps' in result ? result : null;

  return <section className="ipam-card calculator-panel">
    <div className="panel-heading"><div><span className="section-kicker">SUBNETTING</span><h2>Calculadora CIDR IPv4 e IPv6</h2><p className="panel-description">Consulta subnets IPv4 e IPv6 sem enumerar endereços. A divisão em subnets continua disponível para IPv4.</p></div><Calculator size={18} /></div>
    <form className="calculator-form" onSubmit={submit}>
      <label>Operação<select value={operation} onChange={(event) => { setFieldErrors({}); updateCalc({ operation: event.target.value as CalculatorOperation }); }}><option value="split">Dividir subnet IPv4</option><option value="summary">Resumo IPv4/IPv6</option><option value="contains">Verificar endereço</option><option value="overlap">Verificar sobreposição</option></select></label>
      {operation === 'split' ? <>
        <label>Subnet em questão<input required maxLength={15} inputMode="numeric" pattern="[0-9.]+" placeholder="10.80.80.0" value={calc.address} onChange={(event) => {
          const address = event.target.value.replace(/[^0-9.]/g, '').slice(0, 15);
          setFieldErrors((current) => ({ ...current, subnet: undefined }));
          updateCalc({ address });
        }} aria-invalid={Boolean(fieldErrors.subnet)} aria-describedby={fieldErrors.subnet ? 'calculator-subnet-error' : undefined} />
          <small>Apenas números e pontos · máximo 15 caracteres.</small>{fieldErrors.subnet && <small id="calculator-subnet-error" className="calculator-field-error" role="alert">{fieldErrors.subnet}</small>}</label>
        <label>Máscara base<select value={calc.basePrefix} onChange={(event) => {
          const basePrefix = event.target.value;
          updateCalc({ basePrefix, newPrefix: Number(calc.newPrefix) < Number(basePrefix) ? basePrefix : calc.newPrefix });
        }}>{Array.from({ length: 33 }, (_, i) => i).map((prefix) => <option key={prefix} value={prefix}>/{prefix} ({ipv4Mask(prefix)})</option>)}</select></label>
        <label>Máscara destino<select value={calc.newPrefix} onChange={(event) => updateCalc({ newPrefix: event.target.value })}>{Array.from({ length: 33 }, (_, i) => i).filter((prefix) => prefix >= Number(calc.basePrefix)).map((prefix) => <option key={prefix} value={prefix}>/{prefix} ({ipv4Mask(prefix)})</option>)}</select></label>
      </> : <>
        <label>Subnet CIDR<input required maxLength={43} placeholder="2001:db8:1234::/48" value={calc.cidr ?? ''} onChange={(event) => { setFieldErrors((current) => ({ ...current, cidr: undefined })); updateCalc({ cidr: event.target.value }); }} aria-invalid={Boolean(fieldErrors.cidr)} aria-describedby={fieldErrors.cidr ? 'calculator-cidr-error' : undefined} />
          {fieldErrors.cidr && <small id="calculator-cidr-error" className="calculator-field-error" role="alert">{fieldErrors.cidr}</small>}</label>
        {operation === 'contains' && <label>Endereço a verificar<input required maxLength={39} placeholder="2001:db8:1234::1" value={calc.containsAddress ?? ''} onChange={(event) => { setFieldErrors((current) => ({ ...current, address: undefined })); updateCalc({ containsAddress: event.target.value }); }} aria-invalid={Boolean(fieldErrors.address)} aria-describedby={fieldErrors.address ? 'calculator-address-error' : undefined} />
          {fieldErrors.address && <small id="calculator-address-error" className="calculator-field-error" role="alert">{fieldErrors.address}</small>}</label>}
        {operation === 'overlap' && <label>Outras subnets CIDR<input required maxLength={1000} placeholder="2001:db8:1234:1::/64, 2001:db8:ffff::/48" value={calc.cidrsText ?? ''} onChange={(event) => { setFieldErrors((current) => ({ ...current, candidates: undefined })); updateCalc({ cidrsText: event.target.value }); }} aria-invalid={Boolean(fieldErrors.candidates)} aria-describedby={fieldErrors.candidates ? 'calculator-candidates-error' : undefined} />
          <small>Separa as subnets por vírgulas ou linhas.</small>{fieldErrors.candidates && <small id="calculator-candidates-error" className="calculator-field-error" role="alert">{fieldErrors.candidates}</small>}</label>}
      </>}
      <button className="primary-button" disabled={pending} aria-busy={pending}><Calculator size={14} /> {pending ? 'A calcular…' : 'Calcular'}</button>
    </form>
    <div className="calculator-live-status" role="status" aria-live="polite" aria-atomic="true">{pending ? 'A calcular…' : result ? 'Resultados atualizados.' : ''}</div>
    <div className="calculator-results">
      {splitResult && <div className="calculator-summary"><strong>{splitResult.subnetCount} subnets /{splitResult.newPrefix}</strong><span>Rede base normalizada: <code>{splitResult.parent}</code></span></div>}
      {summaryResult && <div className="calculator-summary"><strong>IPv{summaryResult.version} · {summaryResult.cidr}</strong><span>{summaryResult.version === 4 ? 'Endereços totais' : 'Endereços teóricos'}: <code>{summaryResult.total?.toLocaleString?.() ?? summaryResult.total ?? 'não calculados'}</code></span>{summaryResult.version === 4 && <><span>Primeiro endereço utilizável: <code>{summaryResult.firstUsable}</code></span><span>Último endereço utilizável: <code>{summaryResult.lastUsable}</code></span>{summaryResult.broadcast && <span>Broadcast: <code>{summaryResult.broadcast}</code></span>}</>}</div>}
      {containsResult && <div className="calculator-summary"><strong>{containsResult.address} {containsResult.contains ? 'pertence' : 'não pertence'} a {containsResult.cidr}</strong></div>}
      {overlapResult && <div className="calculator-summary"><strong>{overlapResult.overlaps.length ? 'Subnets sobrepostas' : 'Sem sobreposição'}</strong>{overlapResult.overlaps.map((cidr) => <span key={cidr}><code>{cidr}</code></span>)}</div>}
      {splitResult && subnets.length > 0 && <>
        <div className="subnet-results" role="list" aria-label="Subnets calculadas">{visibleSubnets.map((subnet) => <article className="calculated-subnet" key={subnet.cidr} role="listitem"><div className="calculated-subnet-number">{subnet.number}</div><div className="calculated-subnet-content"><strong><code>{subnet.cidr}</code></strong><div><span>IPs utilizáveis</span><code>{subnet.usableRange}</code></div><div><span>Broadcast IP</span><code>{subnet.broadcast}</code></div></div></article>)}</div>
        <nav className="calculator-pagination" aria-label="Páginas das subnets"><span>{start + 1}-{Math.min(start + subnetPageSize, subnets.length)} de {subnets.length}</span><div className="calculator-page-buttons"><button type="button" aria-label="Página anterior" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>‹</button>{pageNumbers.map((number, index) => <span key={number}>{index > 0 && number - pageNumbers[index - 1] > 1 && <em>…</em>}<button type="button" className={number === currentPage ? 'active' : ''} aria-current={number === currentPage ? 'page' : undefined} onClick={() => setPage(number)}>{number}</button></span>)}<button type="button" aria-label="Página seguinte" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>›</button></div></nav>
      </>}
    </div>
  </section>;
}
