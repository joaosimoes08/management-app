import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { capacityResourceHref, type CapacityOutlook, type CapacityOutlookItem } from './capacity-outlook-api';
import { CapacityOutlookCard } from './capacity-outlook';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ authenticated: false, loading: false }) }));

const current: CapacityOutlookItem = {
  id: 'rack-1', kind: 'RACK_SPACE', name: 'Bastidor A', rackId: 'rack-1', roomId: 'room-1', buildingId: 'building-1',
  currentPercent: 88, trendPer30Days: null, estimatedAt: null, observedAt: '2026-11-21T00:00:00Z',
  sampleCount: 2, status: 'INSUFFICIENT', level: 'warning',
};
const projected: CapacityOutlookItem = {
  id: 'subnet-1', kind: 'SUBNET', name: '192.0.2.0/24', currentPercent: 80, trendPer30Days: 25,
  estimatedAt: '2026-12-02T00:00:00Z', observedAt: current.observedAt, sampleCount: 3, status: 'PROJECTED', level: 'warning',
};
const data: CapacityOutlook = { siteId: 'site-a', thresholds: { warningPercent: 80, criticalPercent: 90 }, historyDays: 90, items: [current, projected] };

afterEach(() => { cleanup(); localStorage.clear(); });

describe('Site capacity outlook', () => {
  it('ranks estimates first, sorts by utilisation and filters by type', () => {
    render(<I18nProvider><CapacityOutlookCard siteName="Site A" data={data} onRefresh={() => undefined} /></I18nProvider>);
    const table = screen.getByRole('table');
    const names = () => within(table).getAllByRole('link').map((link) => link.textContent);
    expect(names()).toEqual(['192.0.2.0/24', 'Bastidor A']);
    expect(within(table).getByText('Dados insuficientes')).toBeInTheDocument();
    const sort = within(table).getByRole('button', { name: 'Utilização' });
    fireEvent.click(sort);
    fireEvent.click(sort);
    expect(names()).toEqual(['Bastidor A', '192.0.2.0/24']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo de recurso' }), { target: { value: 'SUBNET' } });
    expect(names()).toEqual(['192.0.2.0/24']);
    expect(within(table).getByRole('link')).toHaveAttribute('href', '/ipam?siteId=site-a&subnetId=subnet-1');
  });

  it('Round 2 #18: notes U reserved for planned installs on rack space rows', () => {
    render(<I18nProvider><CapacityOutlookCard siteName="Site A" data={{ ...data, items: [{ ...current, reservedUnits: 4 }, projected] }} onRefresh={() => undefined} /></I18nProvider>);
    expect(within(screen.getByRole('table')).getByText('Espaço no bastidor · 4 U reservadas')).toBeInTheDocument();
    cleanup();
    render(<I18nProvider><CapacityOutlookCard siteName="Site A" data={{ ...data, items: [{ ...current, reservedUnits: 0 }] }} onRefresh={() => undefined} /></I18nProvider>);
    expect(within(screen.getByRole('table')).getByText('Espaço no bastidor')).toBeInTheDocument();
  });

  it('targets the individual NetApp object and PDU', () => {
    expect(capacityResourceHref({ ...current, kind: 'NETAPP_VOLUME', id: 'vol/1' }, 'site-a')).toBe('/netapp?siteId=site-a&trendKind=VOLUME&trendKey=vol%2F1#netapp-capacity-trend');
    expect(capacityResourceHref({ ...current, kind: 'PDU_POWER', id: 'pdu-1' }, 'site-a')).toBe('/infraestrutura?siteId=site-a&rackId=rack-1&roomId=room-1&buildingId=building-1&pduId=pdu-1');
  });

  it('renders translated labels and the chosen critical threshold', async () => {
    localStorage.setItem('cociber.locale', 'en-US');
    render(<I18nProvider><CapacityOutlookCard siteName="Site A" data={{ ...data, thresholds: { warningPercent: 70, criticalPercent: 85 } }} onRefresh={() => undefined} /></I18nProvider>);
    expect(await screen.findByRole('heading', { name: 'Capacity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Estimate at 85%/ })).toBeInTheDocument();
    expect(screen.getByText('Insufficient data')).toBeInTheDocument();
  });
});
