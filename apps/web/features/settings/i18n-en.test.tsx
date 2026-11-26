import { cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFormatLocale } from '@/lib/format/date';
import { CalculatorView } from '@/features/ipam/components/calculator-view';
import type { CalculatorInput, CalculatorResult } from '@/features/ipam/types';
import { utilizationBadge } from '@/features/ipam/utilization';
import { subnetFilterLabels } from '@/features/ipam/subnet-filters';
import { failureLabel, groupDeliveryNote, type ChannelStatus } from './components/notification-channels-settings';

// Render IPAM and Settings components as the app does in English.
vi.mock('@/lib/i18n/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/i18n/i18n')>();
  return { ...actual, useOptionalI18n: () => ({ t: (key: string, fallback?: string, params?: Record<string, string | number>) => actual.translateMessage('en-US', key, fallback, params) }) };
});

const calc: CalculatorInput = { address: '10.0.0.0', basePrefix: '24', newPrefix: '27', operation: 'split', cidr: '', containsAddress: '', cidrsText: '' };
function Calculator({ result }: { result: CalculatorResult }) {
  const [value, setValue] = useState(calc);
  return <CalculatorView calc={value} setCalc={setValue} result={result} clearResult={() => undefined} pending={false} onSubmit={vi.fn()} />;
}
const groupChannel = (overrides: Partial<ChannelStatus>): ChannelStatus => ({ kind: 'EMAIL', target: 'GROUP_ALERTS', enabled: false, configured: false, minSeverity: null, updatedAt: null, ...overrides });

describe('IPAM and settings in en-US', () => {
  afterEach(() => { cleanup(); setFormatLocale('pt-PT'); });

  it('renders the IPAM calculator in English', () => {
    render(<Calculator result={{ cidr: '2001:db8::/32', address: '2001:db8::1', contains: true }} />);
    expect(screen.getByText('2001:db8::1 is in 2001:db8::/32')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Results updated.');
    expect(screen.queryByText(/pertence|Calcular/)).toBeNull();
  });

  it('builds notification failure reasons and delivery notes in the app language', () => {
    expect(failureLabel('TIMEOUT')).toBe('Sem resposta em 10 s');
    expect(groupDeliveryNote(groupChannel({ delivery: { ready: false, missing: ['enabled', 'destination', 'minSeverity'] } }))).toBe('Não envia alertas: falta ativar o canal, configurar o servidor SMTP e os destinatários e escolher a severidade mínima.');
    setFormatLocale('en-US');
    expect(failureLabel('TIMEOUT')).toBe('No response within 10 s');
    expect(failureLabel('HTTP_429')).toBe('Teams responded HTTP 429');
    expect(failureLabel('UNKNOWN_CODE')).toBe('UNKNOWN_CODE');
    expect(groupDeliveryNote(groupChannel({ delivery: { ready: false, missing: ['enabled', 'minSeverity'] } }))).toBe('Not sending alerts: still need to turn on the channel and choose the minimum severity.');
  });

  it('builds IPAM utilization badges and filter chips in the app language', () => {
    const utilization = { band: 'CRITICAL', utilizationPercent: 95, allocated: 243, usableCapacity: 254, free: 11 } as Parameters<typeof utilizationBadge>[0];
    expect(utilizationBadge(utilization)?.title).toBe('243 de 254 alocados · 11 livres');
    setFormatLocale('en-US');
    expect(utilizationBadge(utilization)?.title).toBe('243 of 254 allocated · 11 free');
    expect(utilizationBadge(utilization)?.label).toMatch(/Critical$/);
    expect(subnetFilterLabels({ band: 'WARNING,CRITICAL', minUtilization: '50', sort: 'cidr' })).toEqual(['Utilization: Warning (≥ 80%), Critical (≥ 90%)', 'Minimum utilization: 50%', 'Sorted by CIDR']);
  });
});
