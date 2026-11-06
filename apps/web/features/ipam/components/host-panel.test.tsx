import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostPanel } from './host-panel';
import type { HostDetail } from '../types';

const { updateHost, updateService } = vi.hoisted(() => ({ updateHost: vi.fn(), updateService: vi.fn() }));
vi.mock('../api', () => ({
  createService: vi.fn(),
  deleteHost: vi.fn(),
  deleteService: vi.fn(),
  unlinkHostIpAddress: vi.fn(),
  updateHost,
  updateService,
}));

const host: HostDetail = {
  id: 'host-1', name: 'edge-router', status: 'ACTIVE', source: 'MANUAL',
  ipAddresses: [],
  services: [{ id: 'service-1', name: 'HTTPS', protocol: 'TCP', port: 443, status: 'ACTIVE', observedStatus: 'OPEN', version: '1.0', notes: 'public endpoint', source: 'MANUAL' }],
};

describe('HostPanel service editing', () => {
  beforeEach(() => {
    updateHost.mockReset().mockResolvedValue({});
    updateService.mockReset().mockResolvedValue({});
  });
  afterEach(cleanup);

  it('loads service fields into the edit form and saves them through the scoped update API', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    render(createElement(HostPanel, { host, canEdit: true, close: vi.fn(), reload, success: vi.fn(), toastError: vi.fn() }));

    fireEvent.click(screen.getByRole('button', { name: 'Editar Service HTTPS' }));
    expect(screen.getByLabelText('Nome')).toHaveValue('HTTPS');
    expect(screen.getByLabelText('Porta')).toHaveValue(443);
    expect(screen.getByLabelText('Notas')).toHaveValue('public endpoint');

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Web HTTPS' } });
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'DEGRADED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Service' }));

    await waitFor(() => expect(updateService).toHaveBeenCalledWith('service-1', {
      name: 'Web HTTPS', protocol: 'TCP', status: 'DEGRADED', version: '1.0', notes: 'public endpoint', port: 443,
    }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Guardar Service' })).not.toBeInTheDocument();
  });

  it('does not expose Host or Service edit controls without edit access', () => {
    render(createElement(HostPanel, { host, canEdit: false, close: vi.fn(), reload: vi.fn(), success: vi.fn(), toastError: vi.fn() }));

    expect(screen.queryByRole('button', { name: 'Editar Service HTTPS' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Editar$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar Service' })).not.toBeInTheDocument();
  });

  it('clears optional Host fields when their edit inputs are emptied', async () => {
    render(createElement(HostPanel, { host, canEdit: true, close: vi.fn(), reload: vi.fn().mockResolvedValue(undefined), success: vi.fn(), toastError: vi.fn() }));

    fireEvent.click(screen.getByRole('button', { name: /^Editar$/ }));
    const hostForm = within(document.querySelector('.host-edit-form')!);
    fireEvent.change(hostForm.getByLabelText('Hostname'), { target: { value: '' } });
    fireEvent.change(hostForm.getByLabelText('Notas'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(updateHost).toHaveBeenCalledWith('host-1', expect.objectContaining({ hostname: null, notes: null })));
  });

  it('clears optional Service metadata and its port when switching to OTHER', async () => {
    render(createElement(HostPanel, { host, canEdit: true, close: vi.fn(), reload: vi.fn().mockResolvedValue(undefined), success: vi.fn(), toastError: vi.fn() }));

    fireEvent.click(screen.getByRole('button', { name: 'Editar Service HTTPS' }));
    fireEvent.change(screen.getByLabelText('Protocolo'), { target: { value: 'OTHER' } });
    fireEvent.change(screen.getByLabelText('Versão'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Notas'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Service' }));

    await waitFor(() => expect(updateService).toHaveBeenCalledWith('service-1', expect.objectContaining({ protocol: 'OTHER', port: null, version: null, notes: null })));
  });
});
