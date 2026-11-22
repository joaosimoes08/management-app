import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RackUnitReservation } from '../../api';
import { RackUnitReservations, reservationUnits } from './rack-unit-reservations';

const mocks = vi.hoisted(() => ({ listRackUnitReservations: vi.fn(), createRackUnitReservation: vi.fn(), releaseRackUnitReservation: vi.fn() }));
vi.mock('../../api', () => mocks);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const reservation = (overrides: Partial<RackUnitReservation> = {}): RackUnitReservation => ({ id: 'res-1', rackId: 'rack-a', startUnit: 10, size: 4, reason: 'Storage planeado', expiresAt: null, createdAt: '2026-11-22T10:00:00.000Z', createdBy: { id: 'u1', username: 'ana', displayName: 'Ana' }, ...overrides });

describe('Rack U reservations (Round 2 #18)', () => {
  it('labels the reserved span', () => {
    expect(reservationUnits({ startUnit: 10, size: 4 })).toBe('U10–U13');
    expect(reservationUnits({ startUnit: 7, size: 1 })).toBe('U7');
  });

  it('reserves units through the modal and releases one only after confirmation', async () => {
    mocks.listRackUnitReservations.mockResolvedValueOnce([reservation()]).mockResolvedValueOnce([reservation(), reservation({ id: 'res-2', startUnit: 20, size: 2, reason: 'Firewall nova', createdBy: null })]).mockResolvedValueOnce([reservation({ id: 'res-2', startUnit: 20, size: 2, reason: 'Firewall nova', createdBy: null })]);
    mocks.createRackUnitReservation.mockResolvedValue(reservation({ id: 'res-2' }));
    mocks.releaseRackUnitReservation.mockResolvedValue({ id: 'res-1', releasedAt: '2026-11-22T11:00:00.000Z' });
    render(<RackUnitReservations rackId="rack-a" rackUnits={42} canEdit />);
    expect(await screen.findByText('U10–U13')).toBeInTheDocument();
    expect(screen.getByText('Storage planeado · Ana')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Reservar U/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('U inicial'), { target: { value: '41' } });
    fireEvent.change(within(dialog).getByLabelText('Número de U'), { target: { value: '4' } });
    fireEvent.change(within(dialog).getByLabelText('Motivo'), { target: { value: 'Firewall nova' } });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Reservar' }).closest('form')!);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('entre U1 e U42');
    expect(mocks.createRackUnitReservation).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('U inicial'), { target: { value: '20' } });
    fireEvent.change(within(dialog).getByLabelText('Número de U'), { target: { value: '2' } });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Reservar' }).closest('form')!);
    await waitFor(() => expect(mocks.createRackUnitReservation).toHaveBeenCalledWith('rack-a', { startUnit: 20, size: 2, reason: 'Firewall nova' }));
    expect(await screen.findByText('U20–U21')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Libertar' })[0]);
    const confirm = await screen.findByRole('alertdialog', { name: 'Libertar reserva' });
    expect(mocks.releaseRackUnitReservation).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Libertar' }));
    await waitFor(() => expect(mocks.releaseRackUnitReservation).toHaveBeenCalledWith('rack-a', 'res-1'));
    await waitFor(() => expect(screen.queryByText('U10–U13')).toBeNull());
  });

  it('shows reservations read-only without actions, and nothing when there are none', async () => {
    mocks.listRackUnitReservations.mockResolvedValueOnce([reservation()]);
    render(<RackUnitReservations rackId="rack-a" rackUnits={42} canEdit={false} />);
    expect(await screen.findByText('U10–U13')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reservar U|Libertar/ })).toBeNull();
    cleanup();
    mocks.listRackUnitReservations.mockResolvedValueOnce([]);
    const { container } = render(<RackUnitReservations rackId="rack-a" rackUnits={42} canEdit={false} />);
    await waitFor(() => expect(mocks.listRackUnitReservations).toHaveBeenCalledTimes(2));
    expect(container.querySelector('.rack-unit-reservations')).toBeNull();
  });
});
