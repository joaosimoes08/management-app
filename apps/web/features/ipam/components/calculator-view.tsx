'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Calculator } from 'lucide-react';
import type { CalculatorInput, CalculatorResult, CalculatorOperation } from '../types';
import { ipv4Mask, isValidCidr, isValidIpAddress, isValidIpv4 } from '../utils';
import { useUiText } from '@/components/ui/use-ui-text';
import { PageToolbarPortal } from '@/components/layout/app-shell';

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
  const ui = useUiText();
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
    if (operation === 'split' && !isValidIpv4(calc.address)) errors.subnet = ui('ipam.calc.error.ipv4');
    if (operation !== 'split' && !isValidCidr(calc.cidr ?? '')) errors.cidr = ui('ipam.calc.error.cidr');
    if (operation === 'contains' && !isValidIpAddress(calc.containsAddress ?? '')) errors.address = ui('ipam.calc.error.address');
    if (operation === 'overlap') {
      const candidates = (calc.cidrsText ?? '').split(/[\n,;]+/).map((cidr) => cidr.trim()).filter(Boolean);
      if (!candidates.length) errors.candidates = ui('ipam.calc.error.noCandidates');
      else if (candidates.some((cidr) => !isValidCidr(cidr))) errors.candidates = ui('ipam.calc.error.candidateFormat');
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
    <div className="panel-heading"><div><h2>{ui('ipam.calc.title')}</h2><p className="panel-description">{ui('ipam.calc.description')}</p></div><Calculator size={18} /></div>
    <PageToolbarPortal><button type="submit" form="ipam-calculator-form" className="primary-button" disabled={pending} aria-busy={pending}><Calculator size={14} /> {pending ? ui('ipam.calc.calculating') : ui('ipam.calc.calculate')}</button></PageToolbarPortal>
    <form id="ipam-calculator-form" className="calculator-form" onSubmit={submit}>
      <label>{ui('ipam.calc.operation')}<select value={operation} onChange={(event) => { setFieldErrors({}); updateCalc({ operation: event.target.value as CalculatorOperation }); }}><option value="split">{ui('ipam.calc.op.split')}</option><option value="summary">{ui('ipam.calc.op.summary')}</option><option value="contains">{ui('ipam.calc.op.contains')}</option><option value="overlap">{ui('ipam.calc.op.overlap')}</option></select></label>
      {operation === 'split' ? <>
        <label>{ui('ipam.calc.subnet')}<input required maxLength={15} inputMode="numeric" pattern="[0-9.]+" placeholder="10.80.80.0" value={calc.address} onChange={(event) => {
          const address = event.target.value.replace(/[^0-9.]/g, '').slice(0, 15);
          setFieldErrors((current) => ({ ...current, subnet: undefined }));
          updateCalc({ address });
        }} aria-invalid={Boolean(fieldErrors.subnet)} aria-describedby={fieldErrors.subnet ? 'calculator-subnet-error' : undefined} />
          <small>{ui('ipam.calc.subnetHint')}</small>{fieldErrors.subnet && <small id="calculator-subnet-error" className="calculator-field-error" role="alert">{fieldErrors.subnet}</small>}</label>
        <label>{ui('ipam.calc.basePrefix')}<select value={calc.basePrefix} onChange={(event) => {
          const basePrefix = event.target.value;
          updateCalc({ basePrefix, newPrefix: Number(calc.newPrefix) < Number(basePrefix) ? basePrefix : calc.newPrefix });
        }}>{Array.from({ length: 33 }, (_, i) => i).map((prefix) => <option key={prefix} value={prefix}>/{prefix} ({ipv4Mask(prefix)})</option>)}</select></label>
        <label>{ui('ipam.calc.newPrefix')}<select value={calc.newPrefix} onChange={(event) => updateCalc({ newPrefix: event.target.value })}>{Array.from({ length: 33 }, (_, i) => i).filter((prefix) => prefix >= Number(calc.basePrefix)).map((prefix) => <option key={prefix} value={prefix}>/{prefix} ({ipv4Mask(prefix)})</option>)}</select></label>
      </> : <>
        <label>{ui('ipam.calc.cidr')}<input required maxLength={43} placeholder="2001:db8:1234::/48" value={calc.cidr ?? ''} onChange={(event) => { setFieldErrors((current) => ({ ...current, cidr: undefined })); updateCalc({ cidr: event.target.value }); }} aria-invalid={Boolean(fieldErrors.cidr)} aria-describedby={fieldErrors.cidr ? 'calculator-cidr-error' : undefined} />
          {fieldErrors.cidr && <small id="calculator-cidr-error" className="calculator-field-error" role="alert">{fieldErrors.cidr}</small>}</label>
        {operation === 'contains' && <label>{ui('ipam.calc.containsAddress')}<input required maxLength={39} placeholder="2001:db8:1234::1" value={calc.containsAddress ?? ''} onChange={(event) => { setFieldErrors((current) => ({ ...current, address: undefined })); updateCalc({ containsAddress: event.target.value }); }} aria-invalid={Boolean(fieldErrors.address)} aria-describedby={fieldErrors.address ? 'calculator-address-error' : undefined} />
          {fieldErrors.address && <small id="calculator-address-error" className="calculator-field-error" role="alert">{fieldErrors.address}</small>}</label>}
        {operation === 'overlap' && <label>{ui('ipam.calc.candidates')}<input required maxLength={1000} placeholder="2001:db8:1234:1::/64, 2001:db8:ffff::/48" value={calc.cidrsText ?? ''} onChange={(event) => { setFieldErrors((current) => ({ ...current, candidates: undefined })); updateCalc({ cidrsText: event.target.value }); }} aria-invalid={Boolean(fieldErrors.candidates)} aria-describedby={fieldErrors.candidates ? 'calculator-candidates-error' : undefined} />
          <small>{ui('ipam.calc.candidatesHint')}</small>{fieldErrors.candidates && <small id="calculator-candidates-error" className="calculator-field-error" role="alert">{fieldErrors.candidates}</small>}</label>}
      </>}
    </form>
    <div className="calculator-live-status" role="status" aria-live="polite" aria-atomic="true">{pending ? ui('ipam.calc.calculating') : result ? ui('ipam.calc.updated') : ''}</div>
    <div className="calculator-results">
      {splitResult && <div className="calculator-summary"><strong>{ui('ipam.calc.splitCount', undefined, { count: splitResult.subnetCount, prefix: splitResult.newPrefix })}</strong><span>{ui('ipam.calc.normalizedBase')} <code>{splitResult.parent}</code></span></div>}
      {summaryResult && <div className="calculator-summary"><strong>IPv{summaryResult.version} · {summaryResult.cidr}</strong><span>{summaryResult.version === 4 ? ui('ipam.calc.totalAddresses') : ui('ipam.calc.theoreticalAddresses')} <code>{summaryResult.total?.toLocaleString?.() ?? summaryResult.total ?? ui('ipam.calc.notCalculated')}</code></span>{summaryResult.version === 4 && <><span>{ui('ipam.calc.firstUsable')} <code>{summaryResult.firstUsable}</code></span><span>{ui('ipam.calc.lastUsable')} <code>{summaryResult.lastUsable}</code></span>{summaryResult.broadcast && <span>{ui('ipam.calc.broadcast')} <code>{summaryResult.broadcast}</code></span>}</>}</div>}
      {containsResult && <div className="calculator-summary"><strong>{ui(containsResult.contains ? 'ipam.calc.contains' : 'ipam.calc.notContains', undefined, { address: containsResult.address ?? '', cidr: containsResult.cidr })}</strong></div>}
      {overlapResult && <div className="calculator-summary"><strong>{overlapResult.overlaps.length ? ui('ipam.calc.overlaps') : ui('ipam.calc.noOverlap')}</strong>{overlapResult.overlaps.map((cidr) => <span key={cidr}><code>{cidr}</code></span>)}</div>}
      {splitResult && subnets.length > 0 && <>
        <div className="subnet-results" role="list" aria-label={ui('ipam.calc.results')}>{visibleSubnets.map((subnet) => <article className="calculated-subnet" key={subnet.cidr} role="listitem"><div className="calculated-subnet-number">{subnet.number}</div><div className="calculated-subnet-content"><strong><code>{subnet.cidr}</code></strong><div><span>{ui('ipam.calc.usableIps')}</span><code>{subnet.usableRange}</code></div><div><span>{ui('ipam.calc.broadcastIp')}</span><code>{subnet.broadcast}</code></div></div></article>)}</div>
        <nav className="calculator-pagination" aria-label={ui('ipam.calc.pages')}><span>{ui('ipam.calc.pageRange', undefined, { from: start + 1, to: Math.min(start + subnetPageSize, subnets.length), total: subnets.length })}</span><div className="calculator-page-buttons"><button type="button" aria-label={ui('ui.previousPage')} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>‹</button>{pageNumbers.map((number, index) => <span key={number}>{index > 0 && number - pageNumbers[index - 1] > 1 && <em>…</em>}<button type="button" className={number === currentPage ? 'active' : ''} aria-current={number === currentPage ? 'page' : undefined} onClick={() => setPage(number)}>{number}</button></span>)}<button type="button" aria-label={ui('ui.nextPage')} disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>›</button></div></nav>
      </>}
    </div>
  </section>;
}
