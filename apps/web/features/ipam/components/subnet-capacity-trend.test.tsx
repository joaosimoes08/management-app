import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SubnetCapacityTrend } from './subnet-capacity-trend';

describe('SubnetCapacityTrend', () => {
  it('shows IPv4 usage history and only a supported exhaustion forecast', () => {
    render(<SubnetCapacityTrend history={{
      subnet: { id: 's1', cidr: '192.0.2.0/24', version: 4, gateway: '192.0.2.1' },
      samples: [
        { sampledAt: '2026-01-01T00:00:00.000Z', version: 4, usableCapacity: 253, trackedAddresses: 10, occupiedAddresses: 10, reservedAddresses: 0, allocatedAddresses: 10, freeAddresses: 243, utilizationPercent: 3.95 },
        { sampledAt: '2026-01-09T00:00:00.000Z', version: 4, usableCapacity: 253, trackedAddresses: 18, occupiedAddresses: 18, reservedAddresses: 0, allocatedAddresses: 18, freeAddresses: 235, utilizationPercent: 7.11 },
      ],
      forecast: { status: 'AVAILABLE', daysUntilFull: 235, projectedFullAt: '2026-09-01T00:00:00.000Z', dailyGrowth: 1 },
    }} />);
    expect(screen.getByRole('img', { name: 'Tendência de utilização IPv4' })).toBeTruthy();
    expect(screen.getByText(/capacidade total em cerca de 235 dias/)).toBeTruthy();
  });

  it('describes IPv6 as tracked inventory and never claims free prefix capacity', () => {
    render(<SubnetCapacityTrend history={{
      subnet: { id: 's6', cidr: '2001:db8::/64', version: 6, gateway: '2001:db8::1' },
      samples: [{ sampledAt: '2026-01-01T00:00:00.000Z', version: 6, usableCapacity: null, trackedAddresses: 8, occupiedAddresses: 7, reservedAddresses: 1, allocatedAddresses: 8, freeAddresses: null, utilizationPercent: null }],
      forecast: { status: 'TRACKING_ONLY', daysUntilFull: null, projectedFullAt: null, dailyGrowth: null },
    }} />);
    expect(screen.getByRole('img', { name: 'Tendência de endereços IPv6 registados' })).toBeTruthy();
    expect(screen.getByText(/não se estima capacidade livre nem esgotamento do prefixo/)).toBeTruthy();
  });
});
