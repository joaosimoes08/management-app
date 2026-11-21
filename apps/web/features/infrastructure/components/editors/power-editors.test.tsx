import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyRackPower, type RackPowerDraft } from '../../forms';
import type { Rack, RackPdu } from '../../types';
import type { PowerDefaults } from '../../power';
import { TEST_POWER_DEFAULTS } from '../../__fixtures__/power-defaults';
import { DevicePowerFields } from './device-power-fields';
import { DevicePowerStep } from './device-power-step';
import { RackPowerFields } from './rack-power-fields';

vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({
    locale: 'pt-PT',
    t: (key: string, fallback?: string, params?: Record<string, unknown>) => (fallback ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`)),
  }),
}));

let mockDefaults: PowerDefaults | null = TEST_POWER_DEFAULTS;
vi.mock('../../use-power-defaults', () => ({ usePowerDefaults: () => mockDefaults }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); mockDefaults = TEST_POWER_DEFAULTS; });

describe('RackPowerFields', () => {
  it('defaults to "Só rede elétrica" with only the supplier PDU settings, collapsed', () => {
    const { container } = render(<RackPowerFields value={emptyRackPower(TEST_POWER_DEFAULTS)} onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Só rede elétrica' })).toBeChecked();
    const settings = container.querySelectorAll('details.power-pdu-settings');
    expect(settings).toHaveLength(1);
    expect(settings[0]).not.toHaveAttribute('open');
    expect(screen.getByLabelText('Tomadas')).toHaveValue(32);
    expect(screen.getByLabelText('Potência máxima (W)')).toHaveValue(3680);
  });

  it('takes placeholders and limits from the API defaults, and shows none while they load', () => {
    const { rerender } = render(<RackPowerFields value={emptyRackPower(null)} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Tomadas')).toHaveAttribute('placeholder', '32');
    expect(screen.getByLabelText('Tomadas')).toHaveAttribute('max', '96');
    expect(screen.getByText(/Por omissão 3680 W/)).toBeInTheDocument();
    mockDefaults = { ...TEST_POWER_DEFAULTS, pduOutletCount: 48, pduBudgetWatts: 7360 };
    rerender(<RackPowerFields value={emptyRackPower(mockDefaults)} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Tomadas')).toHaveValue(48);
    expect(screen.getByText(/Por omissão 7360 W/)).toBeInTheDocument();
    mockDefaults = null;
    rerender(<RackPowerFields value={emptyRackPower(null)} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Tomadas')).toHaveAttribute('placeholder', '');
  });

  it('switches to "Rede + UPS" and shows both PDUs', () => {
    const onChange = vi.fn();
    const { rerender, container } = render(<RackPowerFields value={emptyRackPower()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Rede + UPS' }));
    const next = onChange.mock.calls[0][0] as RackPowerDraft;
    expect(next.mode).toBe('SUPPLIER_AND_UPS');
    rerender(<RackPowerFields value={next} onChange={onChange} />);
    expect([...container.querySelectorAll('details')].map((item) => item.getAttribute('data-source'))).toEqual(['SUPPLIER', 'UPS']);
    expect(screen.getByText('Definições da PDU UPS')).toBeInTheDocument();
  });

  it('blocks UPS removal and offers "Desligar todos da UPS"', () => {
    const onDisconnectAllUps = vi.fn();
    render(<RackPowerFields value={emptyRackPower()} onChange={vi.fn()} onDisconnectAllUps={onDisconnectAllUps} blocked={{ kind: 'ups', devices: [{ deviceId: 'd', deviceName: 'Server 1', outlets: [1, 2] }] }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Não é possível remover a UPS');
    expect(alert).toHaveTextContent('Server 1 · 1, 2');
    fireEvent.click(within(alert).getByRole('button', { name: 'Desligar todos da UPS' }));
    expect(onDisconnectAllUps).toHaveBeenCalled();
  });
});

describe('DevicePowerFields', () => {
  const models = [{ id: 'm1', name: 'R740', powerPlugCount: 2, typicalWatts: 450 }] as never[];

  it('shows inherited values as placeholders and the source chip', () => {
    render(<DevicePowerFields form={{ type: 'SERVER', modelId: 'm1', powerPlugCount: '', estimatedWatts: '' }} models={models} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/Fontes \/ fichas/)).toHaveAttribute('placeholder', '2');
    expect(screen.getByRole('spinbutton', { name: /Consumo estimado/ })).toHaveAttribute('placeholder', '450');
    expect(screen.getByLabelText(/Fontes \/ fichas/)).toHaveAttribute('max', '8');
    expect(screen.getByTestId('watts-source')).toHaveTextContent('modelo');
  });

  it('falls back to 2 plugs and the default watts without a model, and marks typed watts manual with a reset', () => {
    const onChange = vi.fn();
    const { rerender } = render(<DevicePowerFields form={{ type: 'SWITCH', modelId: '', powerPlugCount: '', estimatedWatts: '' }} models={[]} onChange={onChange} />);
    expect(screen.getByLabelText(/Fontes \/ fichas/)).toHaveAttribute('placeholder', '2');
    expect(screen.getByTestId('watts-source')).toHaveTextContent('padrão');
    rerender(<DevicePowerFields form={{ type: 'SWITCH', modelId: '', powerPlugCount: '', estimatedWatts: '120' }} models={[]} onChange={onChange} />);
    expect(screen.getByTestId('watts-source')).toHaveTextContent('manual');
    fireEvent.click(screen.getByRole('button', { name: 'Usar valor do padrão' }));
    expect(onChange).toHaveBeenCalledWith({ powerPlugCount: '', estimatedWatts: '' });
  });
});

const pdu = (source: RackPdu['source'], extra: Partial<RackPdu> = {}): RackPdu => ({ id: `pdu-${source}`, rackId: 'r', source, outletCount: 32, connections: [], ...extra });
const step = (rack: Pick<Rack, 'id' | 'name' | 'pdus'>, plugs: number, onSave = vi.fn(async () => {})) => {
  render(<DevicePowerStep device={{ id: 'dev', name: 'Server 1' }} plugs={plugs} rack={rack} onSave={onSave} onSkip={vi.fn()} />);
  return onSave;
};
const rowValues = (plug: number) => {
  const row = screen.getByTestId(`plug-row-${plug}`);
  const [pduSelect, outletSelect] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
  return { pdu: pduSelect, outlet: outletSelect };
};

describe('DevicePowerStep', () => {
  it('alternates supplier / UPS from plug 1 on the next free outlets and saves them', async () => {
    const busy = pdu('SUPPLIER', { connections: [{ deviceId: 'x', deviceName: 'X', outlets: [1] }] });
    const onSave = step({ id: 'r', name: 'R', pdus: [pdu('UPS'), busy] }, 2);
    expect(rowValues(1).pdu.value).toBe('pdu-SUPPLIER');
    expect(rowValues(1).outlet.value).toBe('2');
    expect(rowValues(2).pdu.value).toBe('pdu-UPS');
    expect(rowValues(2).outlet.value).toBe('1');
    expect(within(rowValues(1).pdu).getByRole('option', { name: 'PDU Rede · 31 livres' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Guardar ligações/ })); });
    expect(onSave).toHaveBeenCalledWith({ plugs: [{ plugIndex: 1, pduId: 'pdu-SUPPLIER', outletIndex: 2 }, { plugIndex: 2, pduId: 'pdu-UPS', outletIndex: 1 }] });
  });

  it('warns about no redundancy on a supplier-only rack, and allows "Não ligado" without blocking save', async () => {
    const onSave = step({ id: 'r', name: 'R', pdus: [pdu('SUPPLIER')] }, 2);
    expect(screen.getByText(/não tem alimentação redundante/)).toBeInTheDocument();
    fireEvent.change(rowValues(2).pdu, { target: { value: '' } });
    expect(rowValues(2).outlet).toBeDisabled();
    expect(screen.getByText('1 ficha(s) sem ligação. Podes guardar na mesma.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Guardar ligações/ })); });
    expect(onSave).toHaveBeenCalledWith({ plugs: [{ plugIndex: 1, pduId: 'pdu-SUPPLIER', outletIndex: 1 }, { plugIndex: 2, pduId: null, outletIndex: null }] });
  });

  it('explains a full PDU and leaves that plug unplugged', () => {
    const full = pdu('SUPPLIER', { outletCount: 1, connections: [{ deviceId: 'x', deviceName: 'X', outlets: [1] }] });
    step({ id: 'r', name: 'R', pdus: [full] }, 1);
    expect(rowValues(1).pdu.value).toBe('');
    expect(screen.getByText('Sem tomadas livres em PDU Rede: a ficha fica “Não ligado”.')).toBeInTheDocument();
  });

  it('has nothing to save for a device without plugs', () => {
    step({ id: 'r', name: 'R', pdus: [pdu('SUPPLIER')] }, 0);
    expect(screen.getByText('Sem alimentação: este equipamento não tem fichas.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Guardar ligações/ })).toBeNull();
  });

  it('starts from the existing connections of a device already plugged in', () => {
    const pdus = [pdu('SUPPLIER', { connections: [{ deviceId: 'dev', deviceName: 'Server 1', outlets: [{ outletIndex: 9, plugIndex: 1 }] }] }), pdu('UPS')];
    step({ id: 'r', name: 'R', pdus }, 2);
    expect(rowValues(1).outlet.value).toBe('9');
    expect(rowValues(2).pdu.value).toBe('');
  });
});
