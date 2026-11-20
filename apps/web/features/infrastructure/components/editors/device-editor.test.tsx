import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceForm } from '../../forms';
import type { AssetFile, DeviceModel, Rack } from '../../types';
import type { MappedFieldError } from '../../device-requirements';
import { DeviceEditor } from './device-editor';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: () => true, token: '' }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string, fallback?: string) => fallback ?? key }) }));
vi.mock('../../use-power-defaults', () => ({ usePowerDefaults: () => ({ minPowerPlugCount: 0, maxPowerPlugCount: 8, maxWatts: 20000, pduOutletCount: 24, pduBudgetWatts: 3680, defaultPowerPlugCount: 2, wattsByDeviceType: { SWITCH: 60 } }) }));
vi.mock('../asset-image', () => ({ AssetImage: () => null }));
afterEach(cleanup);

const assets = [{ id: 'rear-1', filename: 'rear-1.png', mimeType: 'image/png' }] as AssetFile[];
const racks = [{ id: 'rack-1', name: 'R1', room: { name: 'Sala' } }] as Rack[];
const empty: DeviceForm = { name: '', type: 'SWITCH', hostname: '', managementIp: '', managementIpAddressId: '', rackId: '', rackUnitStart: '', rackUnitSize: '1', modelId: '', status: 'ACTIVE', isCritical: false, frontAssetId: '', backAssetId: '' };
/** An existing device opened from the API that predates rear images and power settings. */
const legacy: DeviceForm = { ...empty, name: 'SW-OLD', rackId: 'rack-1', rackUnitStart: '10', savedAssetIds: { front: '', rear: '' }, powerPlugCount: '', estimatedWatts: '', savedPower: { plugs: '', watts: '' } };

function Harness({ initial = empty, editingId = '', save = vi.fn().mockResolvedValue(undefined), fieldErrors, initialTab, models = [] as DeviceModel[] }: { initial?: DeviceForm; editingId?: string; save?: (path: string, body: Record<string, unknown>) => Promise<void>; fieldErrors?: MappedFieldError[]; initialTab?: 'geral' | 'localizacao' | 'rede' | 'imagens' | 'energia'; models?: DeviceModel[] }) {
  const [form, setForm] = useState(initial);
  return <QueryClientProvider client={new QueryClient()}><DeviceEditor close={() => {}} editingId={editingId} form={form} setForm={setForm} racks={racks} models={models} assets={assets} ips={[]} save={save} fieldErrors={fieldErrors} initialTab={initialTab} /></QueryClientProvider>;
}

const tab = (name: RegExp) => screen.getByRole('tab', { name });
const guardar = () => screen.getByRole('button', { name: /Guardar/ });
const flush = () => act(async () => { await Promise.resolve(); });

describe('device editor tabs', () => {
  it('renders an accessible tablist with one visible panel', () => {
    render(<Harness initial={{ ...empty, name: 'SW-1' }} />);
    const tabs = within(screen.getByRole('tablist', { name: 'Definições do equipamento' })).getAllByRole('tab');
    expect(tabs.map((item) => item.textContent?.replace(/\d.*$/, ''))).toEqual(['Geral', 'Localização', 'Rede', 'Imagens', 'Energia']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('tabIndex', '0');
    expect(tabs[1]).toHaveAttribute('tabIndex', '-1');
    expect(screen.getByRole('tabpanel', { name: /Geral/ })).toBeVisible();
    expect(document.getElementById('device-panel-energia')).not.toBeVisible();
    expect(tabs[0]).toHaveAttribute('aria-controls', 'device-panel-geral');
  });

  it('moves between tabs with arrow keys, Home and End, and focuses the new tab', () => {
    render(<Harness initial={{ ...empty, name: 'SW-1' }} />);
    tab(/^Geral/).focus();
    fireEvent.keyDown(tab(/^Geral/), { key: 'ArrowRight' });
    expect(tab(/^Localização/)).toHaveAttribute('aria-selected', 'true');
    expect(tab(/^Localização/)).toHaveFocus();
    fireEvent.keyDown(tab(/^Localização/), { key: 'End' });
    expect(tab(/^Energia/)).toHaveFocus();
    fireEvent.keyDown(tab(/^Energia/), { key: 'ArrowRight' });
    expect(tab(/^Geral/)).toHaveFocus();
    fireEvent.keyDown(tab(/^Geral/), { key: 'ArrowLeft' });
    expect(tab(/^Energia/)).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tab(/^Energia/), { key: 'Home' });
    expect(tab(/^Geral/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'device-panel-geral');
  });

  it('opens on the tab a deep link asks for', () => {
    render(<Harness editingId="dev-1" initial={legacy} initialTab="energia" />);
    expect(tab(/^Energia/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'device-panel-energia');
  });
});

describe('device editor required fields', () => {
  it('a new device cannot be saved until name and power are filled; the save attempt jumps to the first missing field', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<Harness save={save} />);
    expect(guardar()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('tab-errors-geral')).toHaveTextContent('1');
    expect(screen.getByTestId('tab-errors-energia')).toHaveTextContent('2');
    expect(screen.getByRole('status')).toHaveTextContent('3 campos obrigatórios em falta');

    fireEvent.click(tab(/^Rede/));
    fireEvent.click(guardar());
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(tab(/^Geral/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/^Nome/)).toHaveFocus();
    expect(screen.getByLabelText(/^Nome/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('O nome é obrigatório.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: 'SW-NEW' } });
    fireEvent.click(guardar());
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(tab(/^Energia/)).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('device-power-plugs')).toHaveFocus();
    expect(screen.getByText(/Indica o número de fontes/)).toBeInTheDocument();

    fireEvent.change(document.getElementById('device-power-plugs')!, { target: { value: '2' } });
    fireEvent.change(document.getElementById('device-power-watts')!, { target: { value: '150' } });
    expect(guardar()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(guardar());
    expect(save).toHaveBeenCalledWith('/api/v1/devices', expect.objectContaining({ name: 'SW-NEW', powerPlugCount: 2, estimatedWatts: 150 }));
  });

  it('a new device in a rack also needs a rear image (the model image counts)', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<Harness save={save} initial={{ ...empty, name: 'SW-R', rackId: 'rack-1', powerPlugCount: '1', estimatedWatts: '40' }} />);
    expect(screen.getByTestId('tab-errors-imagens')).toHaveTextContent('1');
    fireEvent.click(guardar());
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(tab(/^Imagens/)).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('device-rear-image')).toHaveFocus();
    fireEvent.change(document.getElementById('device-rear-image')!, { target: { value: 'rear-1' } });
    fireEvent.click(guardar());
    expect(save).toHaveBeenCalledWith('/api/v1/devices', expect.objectContaining({ backAssetId: 'rear-1' }));
    unmount();

    const model = { id: 'm-1', manufacturer: 'Acme', model: 'X', type: 'SWITCH', backAssetId: 'model-rear', powerPlugCount: 2, typicalWatts: 90 } as DeviceModel;
    render(<Harness save={save} models={[model]} initial={{ ...empty, name: 'SW-M', rackId: 'rack-1', modelId: 'm-1' }} />);
    expect(screen.queryByTestId('tab-errors-imagens')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-errors-energia')).not.toBeInTheDocument();
    expect(guardar()).not.toHaveAttribute('aria-disabled');
  });

  it('an existing device that predates rear image and power can still be saved, with a non-blocking hint', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<Harness editingId="dev-old" initial={legacy} save={save} />);
    expect(screen.getByTestId('tab-hint-imagens')).toBeInTheDocument();
    expect(screen.getByTestId('tab-hint-energia')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-errors-energia')).not.toBeInTheDocument();
    expect(guardar()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(tab(/^Energia/));
    expect(screen.getAllByText(/Configuração em falta/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: 'SW-OLD-2' } });
    fireEvent.click(guardar());
    expect(save).toHaveBeenCalledWith('/api/v1/devices/dev-old', expect.objectContaining({ name: 'SW-OLD-2' }));
  });

  it('an existing device may not clear a required value it already had', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<Harness editingId="dev-1" initial={{ ...legacy, powerPlugCount: '2', estimatedWatts: '120', savedPower: { plugs: '2', watts: '120' } }} save={save} />);
    fireEvent.click(tab(/^Energia/));
    fireEvent.change(document.getElementById('device-power-plugs')!, { target: { value: '' } });
    expect(screen.getByTestId('tab-errors-energia')).toHaveTextContent('1');
    expect(guardar()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(tab(/^Geral/));
    fireEvent.click(guardar());
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(document.getElementById('device-power-plugs')).toHaveFocus();
  });

  it('shows API field errors on their fields and tabs, and clears one when the field changes', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<Harness editingId="dev-old" initial={legacy} save={save} fieldErrors={[{ fieldId: 'device-power-watts', tab: 'energia', message: 'O consumo tem de ser ≥ 0.' }]} />);
    await flush();
    expect(tab(/^Energia/)).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('device-power-watts')).toHaveFocus();
    expect(document.getElementById('device-power-watts')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('O consumo tem de ser ≥ 0.')).toBeInTheDocument();
    expect(screen.getByTestId('tab-errors-energia')).toHaveTextContent('1');
    fireEvent.change(document.getElementById('device-power-watts')!, { target: { value: '80' } });
    expect(screen.queryByText('O consumo tem de ser ≥ 0.')).not.toBeInTheDocument();
    fireEvent.click(guardar());
    expect(save).toHaveBeenCalled();
  });
});
