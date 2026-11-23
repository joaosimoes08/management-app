import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceForm } from '../../forms';
import type { AssetFile, DeviceModel, Rack } from '../../types';
import { REQUIRED_CONFIGS_QUERY_KEY, type MappedFieldError, type RequiredConfigRegistry } from '../../device-requirements';
import { DeviceEditor } from './device-editor';
import { snmpReceiverKey } from '@/features/snmp/api';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: () => true, token: '' }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string, fallback?: string) => fallback ?? key }) }));
vi.mock('../../use-power-defaults', () => ({ usePowerDefaults: () => ({ minPowerPlugCount: 0, maxPowerPlugCount: 8, maxWatts: 20000, pduOutletCount: 24, pduBudgetWatts: 3680, powerPlugCount: 2, wattsByDeviceType: { SWITCH: 60 } }) }));
vi.mock('../asset-image', () => ({ AssetImage: () => null }));
afterEach(cleanup);

const assets = [{ id: 'rear-1', filename: 'rear-1.png', mimeType: 'image/png' }] as AssetFile[];
const racks = [{ id: 'rack-1', name: 'R1', room: { name: 'Sala' } }, { id: 'rack-2', name: 'R2', room: { name: 'Sala' } }] as Rack[];
const registry: RequiredConfigRegistry = {
  tabs: [{ key: 'geral', label: 'Geral' }, { key: 'localizacao', label: 'Localização' }, { key: 'imagens', label: 'Imagens' }, { key: 'energia', label: 'Energia' }],
  configs: [
    { key: 'name', kind: 'CORE', tab: 'geral', fields: ['name'], label: 'Nome', missingMessage: 'Indica o nome do equipamento.' },
    { key: 'type', kind: 'CORE', tab: 'geral', fields: ['type'], label: 'Tipo', missingMessage: 'Escolhe o tipo de equipamento.' },
    { key: 'placement', kind: 'CORE', tab: 'localizacao', fields: ['siteId', 'rackId'], label: 'Site ou bastidor', missingMessage: 'Seleciona um Site ou bastidor para o equipamento.' },
    { key: 'rearImage', kind: 'FEATURE', tab: 'imagens', fields: ['backAssetId'], label: 'Imagem traseira', missingMessage: 'Carrega a imagem traseira do equipamento ou escolhe um modelo que já a tenha.' },
    { key: 'power', kind: 'FEATURE', tab: 'energia', fields: ['power', 'powerPlugCount'], label: 'Tomadas de energia', missingMessage: 'Liga pelo menos uma ficha a uma tomada da PDU, ou indica 0 fichas se o equipamento não tem alimentação.' },
  ],
};
const empty: DeviceForm = { name: '', type: 'SWITCH', hostname: '', managementIp: '', managementIpAddressId: '', rackId: '', rackUnitStart: '', rackUnitSize: '1', modelId: '', status: 'ACTIVE', isCritical: false, frontAssetId: '', backAssetId: '' };
/** An existing device in a rack that predates rear images and outlets (API requiredConfig.missing). */
const legacy: DeviceForm = { ...empty, name: 'SW-OLD', rackId: 'rack-1', rackUnitStart: '10', savedRackId: 'rack-1', requiredMissing: ['rearImage', 'power'], savedAssetIds: { front: '', rear: '' }, powerPlugCount: '', estimatedWatts: '', savedPower: { plugs: '', watts: '' } };

function Harness({ initial = empty, editingId = '', save = vi.fn().mockResolvedValue(undefined), fieldErrors, initialTab, models = [] as DeviceModel[], registryData = registry, v2cAllowed = true }: { initial?: DeviceForm; editingId?: string; save?: (path: string, body: Record<string, unknown>) => Promise<void>; fieldErrors?: MappedFieldError[]; initialTab?: 'geral' | 'localizacao' | 'rede' | 'imagens' | 'energia'; models?: DeviceModel[]; registryData?: RequiredConfigRegistry; v2cAllowed?: boolean }) {
  const [form, setForm] = useState(initial);
  const [client] = useState(() => { const value = new QueryClient(); value.setQueryData(REQUIRED_CONFIGS_QUERY_KEY, registryData); value.setQueryData(snmpReceiverKey, { listenAll: true, selectedInterfaceIds: [], interfaces: [], v2cAllowed }); return value; });
  return <QueryClientProvider client={client}><DeviceEditor close={() => {}} editingId={editingId} form={form} setForm={setForm} racks={racks} models={models} assets={assets} ips={[]} save={save} fieldErrors={fieldErrors} initialTab={initialTab} /></QueryClientProvider>;
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
  beforeEach(() => window.history.replaceState({}, '', '/infraestrutura?siteId=site-1'));

  it('a new device cannot be saved without a name; the save attempt jumps to it from another tab', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<Harness save={save} />);
    expect(guardar()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('tab-errors-geral')).toHaveTextContent('1');
    expect(screen.getByRole('status')).toHaveTextContent('1 campo obrigatório em falta');

    fireEvent.click(tab(/^Rede/));
    fireEvent.click(guardar());
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(tab(/^Geral/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/^Nome/)).toHaveFocus();
    expect(screen.getByLabelText(/^Nome/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Indica o nome do equipamento.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: 'SW-NEW' } });
    expect(guardar()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(guardar());
    expect(save).toHaveBeenCalledWith('/api/v1/devices', expect.objectContaining({ name: 'SW-NEW', siteId: 'site-1', rackId: null }));
    expect(save.mock.calls[0][1]).not.toHaveProperty('power');
  });

  it('without a Site, a new device needs a rack (placement)', async () => {
    window.history.replaceState({}, '', '/infraestrutura');
    render(<Harness initial={{ ...empty, name: 'SW' }} />);
    expect(screen.getByTestId('tab-errors-localizacao')).toHaveTextContent('1');
    fireEvent.click(guardar());
    await flush();
    expect(document.getElementById('device-rack')).toHaveFocus();
    expect(screen.getByText('Seleciona um Site ou bastidor para o equipamento.')).toBeInTheDocument();
  });

  it('a new device in a rack needs a rear image (the model image counts) and is saved with power so its plugs get outlets', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<Harness save={save} initial={{ ...empty, name: 'SW-R', rackId: 'rack-1', powerPlugCount: '1', estimatedWatts: '40' }} />);
    expect(screen.getByTestId('tab-errors-imagens')).toHaveTextContent('1');
    expect(screen.queryByTestId('tab-errors-energia')).not.toBeInTheDocument();
    fireEvent.click(guardar());
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(tab(/^Imagens/)).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('device-rear-image')).toHaveFocus();
    fireEvent.change(document.getElementById('device-rear-image')!, { target: { value: 'rear-1' } });
    fireEvent.click(tab(/^Energia/));
    expect(screen.getByText(/as fichas são ligadas automaticamente/)).toBeInTheDocument();
    fireEvent.click(guardar());
    expect(save).toHaveBeenCalledWith('/api/v1/devices', expect.objectContaining({ backAssetId: 'rear-1', powerPlugCount: 1, estimatedWatts: 40, power: {} }));
    unmount();

    save.mockClear();
    const model = { id: 'm-1', manufacturer: 'Acme', model: 'X', type: 'SWITCH', backAssetId: 'model-rear', powerPlugCount: 0, typicalWatts: 90 } as DeviceModel;
    render(<Harness save={save} models={[model]} initial={{ ...empty, name: 'PP-1', rackId: 'rack-1', modelId: 'm-1' }} />);
    expect(screen.queryByTestId('tab-errors-imagens')).not.toBeInTheDocument();
    expect(guardar()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(guardar());
    // 0 plugs (patch panel): no power to configure.
    expect(save.mock.calls[0][1]).not.toHaveProperty('power');
  });

  it('the requirement list comes from the API registry', () => {
    render(<Harness registryData={{ ...registry, configs: registry.configs.filter((item) => item.key !== 'rearImage') }} initial={{ ...empty, name: 'SW-R', rackId: 'rack-1' }} />);
    expect(screen.queryByTestId('tab-errors-imagens')).not.toBeInTheDocument();
    expect(guardar()).not.toHaveAttribute('aria-disabled');
  });

  it('an existing device that predates rear image and outlets can still be saved, with non-blocking hints', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<Harness editingId="dev-old" initial={legacy} save={save} />);
    expect(screen.getByTestId('tab-hint-imagens')).toBeInTheDocument();
    expect(screen.getByTestId('tab-hint-energia')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-errors-imagens')).not.toBeInTheDocument();
    expect(guardar()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(tab(/^Energia/));
    expect(screen.getAllByText(/Configuração em falta/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: 'SW-OLD-2' } });
    fireEvent.click(guardar());
    expect(save).toHaveBeenCalledWith('/api/v1/devices/dev-old', expect.objectContaining({ name: 'SW-OLD-2' }));
    expect(save.mock.calls[0][1]).not.toHaveProperty('power');
  });

  it('an existing device may not clear a rear image it already had', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<Harness editingId="dev-1" initial={{ ...legacy, requiredMissing: [], backAssetId: 'rear-1', savedAssetIds: { front: '', rear: 'rear-1' } }} save={save} />);
    expect(screen.queryByTestId('tab-hint-imagens')).not.toBeInTheDocument();
    fireEvent.click(tab(/^Imagens/));
    fireEvent.change(document.getElementById('device-rear-image')!, { target: { value: '' } });
    expect(screen.getByTestId('tab-errors-imagens')).toHaveTextContent('1');
    expect(guardar()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(tab(/^Geral/));
    fireEvent.click(guardar());
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(document.getElementById('device-rear-image')).toHaveFocus();
  });

  it('moving an existing device to another rack sends power (the API refuses the move otherwise)', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<Harness editingId="dev-1" initial={{ ...legacy, requiredMissing: [], backAssetId: 'rear-1', savedAssetIds: { front: '', rear: 'rear-1' } }} save={save} />);
    fireEvent.click(tab(/^Localização/));
    fireEvent.change(document.getElementById('device-rack')!, { target: { value: 'rack-2' } });
    fireEvent.click(guardar());
    expect(save).toHaveBeenCalledWith('/api/v1/devices/dev-1', expect.objectContaining({ rackId: 'rack-2', power: {} }));
  });

  describe('a placement change counts like a create (rear image + power, even for a legacy device)', () => {
    /** Guardar is blocked on Imagens, the save attempt jumps there, and once a rear image is chosen it saves with power. */
    async function expectBlockedOnRearImageThenSavesWithPower(save: ReturnType<typeof vi.fn>, path: string) {
      expect(screen.getByTestId('tab-errors-imagens')).toHaveTextContent('1');
      expect(screen.queryByTestId('tab-hint-imagens')).not.toBeInTheDocument();
      expect(guardar()).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(guardar());
      await flush();
      expect(save).not.toHaveBeenCalled();
      expect(tab(/^Imagens/)).toHaveAttribute('aria-selected', 'true');
      expect(document.getElementById('device-rear-image')).toHaveFocus();
      expect(screen.getByText(/Carrega a imagem traseira/)).toBeInTheDocument();
      fireEvent.change(document.getElementById('device-rear-image')!, { target: { value: 'rear-1' } });
      expect(guardar()).not.toHaveAttribute('aria-disabled');
      fireEvent.click(guardar());
      expect(save).toHaveBeenCalledWith(path, expect.objectContaining({ backAssetId: 'rear-1', power: {} }));
    }

    it('legacy device moved from Site only into a rack', async () => {
      const save = vi.fn().mockResolvedValue(undefined);
      render(<Harness editingId="dev-site" initial={{ ...legacy, rackId: '', rackUnitStart: '', savedRackId: '' }} save={save} />);
      expect(guardar()).not.toHaveAttribute('aria-disabled');
      fireEvent.click(tab(/^Localização/));
      fireEvent.change(document.getElementById('device-rack')!, { target: { value: 'rack-1' } });
      await expectBlockedOnRearImageThenSavesWithPower(save, '/api/v1/devices/dev-site');
    });

    it('legacy device moved to another rack', async () => {
      const save = vi.fn().mockResolvedValue(undefined);
      render(<Harness editingId="dev-old" initial={legacy} save={save} />);
      expect(guardar()).not.toHaveAttribute('aria-disabled');
      fireEvent.click(tab(/^Localização/));
      fireEvent.change(document.getElementById('device-rack')!, { target: { value: 'rack-2' } });
      await expectBlockedOnRearImageThenSavesWithPower(save, '/api/v1/devices/dev-old');
    });

    it('legacy device leaving RETIRED inside its rack', async () => {
      const save = vi.fn().mockResolvedValue(undefined);
      render(<Harness editingId="dev-ret" initial={{ ...legacy, status: 'RETIRED' }} save={save} />);
      expect(screen.queryByTestId('tab-errors-imagens')).not.toBeInTheDocument();
      fireEvent.change(document.getElementById('device-status')!, { target: { value: 'ACTIVE' } });
      await expectBlockedOnRearImageThenSavesWithPower(save, '/api/v1/devices/dev-ret');
    });

    it('legacy device going from 0 plugs to some', async () => {
      const save = vi.fn().mockResolvedValue(undefined);
      render(<Harness editingId="dev-0" initial={{ ...legacy, requiredMissing: ['rearImage'], powerPlugCount: '0', savedPower: { plugs: '0', watts: '' } }} save={save} />);
      expect(guardar()).not.toHaveAttribute('aria-disabled');
      fireEvent.click(tab(/^Energia/));
      fireEvent.change(document.getElementById('device-power-plugs')!, { target: { value: '2' } });
      await expectBlockedOnRearImageThenSavesWithPower(save, '/api/v1/devices/dev-0');
      expect(save.mock.calls[0][1]).toEqual(expect.objectContaining({ powerPlugCount: 2 }));
    });

    it('picking RETIRED while racking an active device still counts: the API stores ACTIVE', async () => {
      const save = vi.fn().mockResolvedValue(undefined);
      render(<Harness editingId="dev-site" initial={{ ...legacy, rackId: '', rackUnitStart: '', savedRackId: '', status: 'UNKNOWN' }} save={save} />);
      expect(screen.queryByText('Ao colocar num bastidor, o estado passa a ACTIVE.')).not.toBeInTheDocument();
      fireEvent.change(document.getElementById('device-status')!, { target: { value: 'RETIRED' } });
      fireEvent.click(tab(/^Localização/));
      fireEvent.change(document.getElementById('device-rack')!, { target: { value: 'rack-1' } });
      expect(screen.getByText('Ao colocar num bastidor, o estado passa a ACTIVE.')).toBeInTheDocument();
      await expectBlockedOnRearImageThenSavesWithPower(save, '/api/v1/devices/dev-site');
    });

    it('legacy device staying in its rack still saves with its gaps, without power', () => {
      const save = vi.fn().mockResolvedValue(undefined);
      render(<Harness editingId="dev-old" initial={legacy} save={save} />);
      fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: 'SW-OLD-3' } });
      fireEvent.click(tab(/^Localização/));
      fireEvent.change(document.getElementById('device-rack-unit-start')!, { target: { value: '12' } });
      expect(screen.getByTestId('tab-hint-imagens')).toBeInTheDocument();
      expect(screen.queryByTestId('tab-errors-imagens')).not.toBeInTheDocument();
      expect(guardar()).not.toHaveAttribute('aria-disabled');
      fireEvent.click(guardar());
      expect(save).toHaveBeenCalledWith('/api/v1/devices/dev-old', expect.objectContaining({ name: 'SW-OLD-3' }));
      expect(save.mock.calls[0][1]).not.toHaveProperty('power');
    });
  });

  it('new-device SNMP: v3 is recommended and preselected, v2c shows the trade-off note and checks the community length', () => {
    render(<Harness initial={{ ...empty, snmpEnabled: true }} initialTab="rede" />);
    const version = screen.getByRole('group', { name: 'Versão' });
    expect(within(version).getByRole('radio', { name: /SNMPv3 \(authPriv\)/ })).toBeChecked();
    expect(within(version).getByText('Recomendado')).toBeInTheDocument();
    fireEvent.click(within(version).getByRole('radio', { name: 'SNMPv2c' }));
    expect(within(version).getByRole('note')).toHaveTextContent('prefira SNMPv3 (authPriv)');
    const community = screen.getByLabelText(/^Community READ/);
    fireEvent.change(community, { target: { value: 'abc' } });
    expect(community).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('A community deve ter pelo menos 8 caracteres.')).toBeInTheDocument();
  });

  it('new-device SNMP: v2c is not offered when an admin set SNMP_ALLOW_V2C=false', () => {
    render(<Harness initial={{ ...empty, snmpEnabled: true, snmpVersion: 'V2C' }} initialTab="rede" v2cAllowed={false} />);
    const version = screen.getByRole('group', { name: 'Versão' });
    expect(within(version).queryByRole('radio', { name: 'SNMPv2c' })).not.toBeInTheDocument();
    expect(within(version).getByRole('radio', { name: /SNMPv3 \(authPriv\)/ })).toBeChecked();
    expect(within(version).getByText(/SNMP_ALLOW_V2C=false/)).toBeInTheDocument();
  });

  it('shows API field errors on their fields and tabs, and clears one when the field changes', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<Harness editingId="dev-old" initial={legacy} save={save} fieldErrors={[{ fieldId: 'device-power-plugs', tab: 'energia', message: 'Não há tomadas livres na PDU.' }]} />);
    await flush();
    expect(tab(/^Energia/)).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('device-power-plugs')).toHaveFocus();
    expect(document.getElementById('device-power-plugs')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Não há tomadas livres na PDU.')).toBeInTheDocument();
    expect(screen.getByTestId('tab-errors-energia')).toHaveTextContent('1');
    fireEvent.change(document.getElementById('device-power-plugs')!, { target: { value: '1' } });
    expect(screen.queryByText('Não há tomadas livres na PDU.')).not.toBeInTheDocument();
    fireEvent.click(guardar());
    expect(save).toHaveBeenCalled();
  });
});
