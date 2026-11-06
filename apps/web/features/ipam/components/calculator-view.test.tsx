import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalculatorView } from './calculator-view';
import type { CalculatorInput, CalculatorResult } from '../types';

const initialCalc: CalculatorInput = { address: '10.0.0.0', basePrefix: '24', newPrefix: '27', operation: 'split', cidr: '', containsAddress: '', cidrsText: '' };
afterEach(cleanup);

function Harness({ initialResult = null, pending = false }: { initialResult?: CalculatorResult | null; pending?: boolean }) {
  const [calc, setCalc] = useState(initialCalc);
  const [result, setResult] = useState<CalculatorResult | null>(initialResult);
  return <CalculatorView calc={calc} setCalc={setCalc} result={result} clearResult={() => setResult(null)} pending={pending} onSubmit={vi.fn()} />;
}

describe('IPAM calculator', () => {
  it('renders IPv6 summary results without IPv4-only usable-range or broadcast labels', () => {
    render(<Harness initialResult={{ version: 6, prefix: 48, network: '2001:db8:1234::', cidr: '2001:db8:1234::/48', firstUsable: '2001:db8:1234::', lastUsable: '2001:db8:1234::', total: '1208925819614629174706176' }} />);

    expect(screen.getByText('IPv6 · 2001:db8:1234::/48')).toBeTruthy();
    expect(screen.getByText(/Endereços teóricos/)).toBeTruthy();
    expect(screen.queryByText(/Broadcast|utilizável/i)).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Resultados atualizados.');
  });

  it('renders contains and overlap responses even though they have no subnet array', () => {
    const { rerender } = render(<Harness initialResult={{ cidr: '2001:db8::/32', address: '2001:db8::1', contains: true }} />);
    expect(screen.getByText('2001:db8::1 pertence a 2001:db8::/32')).toBeTruthy();

    rerender(<Harness key="overlap" initialResult={{ cidr: '2001:db8::/32', overlaps: ['2001:db8:1::/48'] }} />);
    expect(screen.getByText('Subnets sobrepostas')).toBeTruthy();
    expect(screen.getByText('2001:db8:1::/48')).toBeTruthy();
  });

  it('announces new results through a polite live region', () => {
    const props = { calc: initialCalc, setCalc: vi.fn(), clearResult: vi.fn(), pending: false, onSubmit: vi.fn() };
    const { rerender } = render(<CalculatorView {...props} result={null} />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('');

    rerender(<CalculatorView {...props} result={{ version: 6, prefix: 48, network: '2001:db8::', cidr: '2001:db8::/48', total: '1208925819614629174706176', firstUsable: '2001:db8::', lastUsable: '2001:db8::' }} />);

    expect(status.textContent).toBe('Resultados atualizados.');
  });

  it('clears previous results when the operation changes', () => {
    render(<Harness initialResult={{ cidr: '10.0.0.0/24', address: '10.0.0.1', contains: true }} />);
    expect(screen.getByText('10.0.0.1 pertence a 10.0.0.0/24')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Operação'), { target: { value: 'summary' } });

    expect(screen.queryByText('10.0.0.1 pertence a 10.0.0.0/24')).toBeNull();
  });

  it('associates contains-address validation with its input', () => {
    function InvalidContains() {
      const [calc, setCalc] = useState<CalculatorInput>({ ...initialCalc, operation: 'contains', cidr: '2001:db8::/32', containsAddress: 'not-an-ip' });
      return <CalculatorView calc={calc} setCalc={setCalc} result={null} clearResult={vi.fn()} pending={false} onSubmit={vi.fn()} />;
    }
    render(<InvalidContains />);

    const address = screen.getByLabelText('Endereço a verificar');
    fireEvent.click(screen.getByRole('button', { name: 'Calcular' }));

    expect(address.getAttribute('aria-invalid')).toBe('true');
    const describedBy = address.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toContain('Indica um endereço IPv4 ou IPv6 válido.');
  });

  it('exposes a disabled pending state on the Calculate button', () => {
    render(<Harness pending />);
    const button = screen.getByRole('button', { name: 'A calcular…' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });
});
