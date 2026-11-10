import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IpReservationModal } from './ip-reservation-modal';

const ip = { id: 'ip-1', address: '192.0.2.18', subnetId: 'subnet-1', state: 'FREE' };

afterEach(cleanup);

describe('IP reservation form', () => {
  it('submits the specific selected address with the 24-hour default and reason', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    render(createElement(IpReservationModal, { ip, close: vi.fn(), submit }));

    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Replace edge router' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Reservar IP' }).closest('form')!);

    await waitFor(() => expect(submit).toHaveBeenCalledWith(24, 'Replace edge router'));
    expect(screen.getByRole('dialog')).toHaveTextContent('192.0.2.18');
  });

  it('limits a custom duration to 30 days', async () => {
    const submit = vi.fn();
    render(createElement(IpReservationModal, { ip, close: vi.fn(), submit }));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '721' } });
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Maintenance window' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Reservar IP' }).closest('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('entre 1 hora e 30 dias');
    expect(submit).not.toHaveBeenCalled();
  });
});
