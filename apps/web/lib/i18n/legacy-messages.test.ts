import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateLegacyText } from './legacy-messages';
import { I18nProvider } from './i18n';
import { SubnetsView } from '@/features/ipam/components/subnets-view';
import type { IpAddressRow } from '@/features/ipam/types';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ authenticated: false, loading: false }) }));

afterEach(cleanup);

describe('legacy infrastructure messages', () => {
  it('translates the selected equipment update fallback', () => {
    expect(translateLegacyText('en-US', 'Não foi possível atualizar os equipamentos selecionados.'))
      .toBe('Could not update the selected equipment.');
  });

  it('translates bulk update outcomes while preserving persistence and audit status', () => {
    expect(translateLegacyText('en-US', '3 guardado(s).')).toBe('3 saved.');
    expect(translateLegacyText('en-US', '1 guardado(s). · Guardados, auditoria falhou: Router: A atualização foi guardada, mas não foi possível registar a auditoria.'))
      .toBe('1 saved. · Saved, but audit failed: Router: The update was saved, but its audit record could not be written.');
    expect(translateLegacyText('en-US', 'Não guardados: Router: Scope denied'))
      .toBe('Not saved: Router: Scope denied');
  });
});

describe('legacy DOM translation updates', () => {
  it('updates the IPAM reservation row and actions when React reuses translated table nodes', async () => {
    const subnet = { id: 'subnet-1', cidr: '10.254.251.0/29', version: 4, siteId: 'site-1' };
    const availableIp: IpAddressRow = { id: 'a1d50edd-9355-4e92-84cc-1172d01512c6', address: '10.254.251.2', subnetId: subnet.id, state: 'FREE', reservations: [] };
    const reservedIp: IpAddressRow = {
      ...availableIp,
      state: 'RESERVED',
      reservations: [{
        id: '5332d317-3095-4d0b-8f6f-dfb9ff2d8b26',
        ipAddressId: availableIp.id,
        createdById: '5fe4638d-30e5-4ab8-9229-84ce52af6b0d',
        expiresAt: '2026-11-11T13:07:52.083Z',
        reason: 'Synthetic exact-head QA reserve/release retest.',
        status: 'ACTIVE',
        releasedAt: null,
        createdAt: '2026-11-10T13:07:52.087Z',
        updatedAt: '2026-11-10T13:07:52.087Z',
      }],
    };

    function ReservationRow() {
      const [ip, setIp] = useState(availableIp);
      return createElement(SubnetsView, {
        selected: subnet, items: [subnet], usage: null, capacityHistory: null, ips: [ip], search: '', setSearch: vi.fn(), openSubnet: vi.fn(), openHost: vi.fn(),
        canEdit: true, canReserve: true, canReleaseReservations: true, siteId: 'site-1', newSubnet: vi.fn(), editSubnet: vi.fn(), removeSubnet: vi.fn(),
        editIp: vi.fn(), newIp: vi.fn(), createHost: vi.fn(),
        reserveIp: () => setIp(reservedIp),
        releaseReservation: () => setIp(availableIp),
      });
    }

    render(createElement(I18nProvider, null, createElement(ReservationRow)));
    fireEvent.click(await screen.findByRole('button', { name: 'Reservar 10.254.251.2' }));

    await waitFor(() => {
      expect(screen.getByText('RESERVED / —')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Libertar reserva de 10.254.251.2' })).toHaveTextContent('Libertar');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Libertar reserva de 10.254.251.2' }));
    await waitFor(() => {
      expect(screen.getByText('FREE / —')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reservar 10.254.251.2' })).toHaveTextContent('Reservar');
    });
  });
});
