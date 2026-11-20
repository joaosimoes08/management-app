import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RACK_VIEW_STORAGE_KEY } from '../../utils';
import { pduView } from '../../power';
import type { Rack, RackPdu } from '../../types';
import { RackDetail } from './rack-detail';
import { RackPduStrip } from './rack-pdu-strip';
import { openPduCardBoxes, placeHoverCard, racksBox } from './rack-device-hover-card';

class TestResizeObserver { observe() {} disconnect() {} unobserve() {} }

vi.mock('./rack-device-zoom', () => ({ RackDeviceZoom: () => null }));
// Interpolates params so badge and totals text can be asserted.
vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({
    locale: 'en',
    t: (key: string, fallback?: string, params?: Record<string, unknown>) => (fallback ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`)),
  }),
}));

let wide = true;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); wide = true; });

const supplier: RackPdu = {
  id: 'pdu-s', rackId: 'rack-a', source: 'SUPPLIER', name: 'PDU A', outletCount: 32, budgetWatts: 3680,
  connections: [
    { deviceId: 'srv', deviceName: 'Server 1', outlets: [{ outletIndex: 1, plugIndex: 1 }], deviceEstimatedWatts: 400 },
    { deviceId: 'sw', deviceName: 'Switch', outlets: [{ outletIndex: 2, plugIndex: 1 }, { outletIndex: 3, plugIndex: 2 }], deviceEstimatedWatts: 200 },
  ],
};
const ups: RackPdu = {
  id: 'pdu-u', rackId: 'rack-a', source: 'UPS', name: 'PDU B', outletCount: 32, budgetWatts: 3680,
  connections: [{ deviceId: 'srv', deviceName: 'Server 1', outlets: [{ outletIndex: 1, plugIndex: 2 }], deviceEstimatedWatts: 400 }],
};
const rack: Rack = { id: 'rack-a', name: 'Core', roomId: 'room-1', units: 42, devices: [], pdus: [ups, supplier] };

function renderRack(view: 'front' | 'rear' | 'both', props: Partial<React.ComponentProps<typeof RackDetail>> = {}) {
  sessionStorage.setItem(RACK_VIEW_STORAGE_KEY, view);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: view === 'both' ? 1600 : 1024 });
  wide = view === 'both';
  return render(<RackDetail rack={rack} onOut={vi.fn()} onDevice={vi.fn()} canEdit={false} onPreviewPlacement={vi.fn()} onPlaceDevice={vi.fn()} onEditDevice={vi.fn()} {...props} />);
}

describe('RackDetail PDU strips', () => {
  it.each(['front', 'rear', 'both'] as const)('draws supplier left and UPS right of the racks, each once, in %s', (view) => {
    const { container } = renderRack(view);
    const inner = container.querySelector('.rack-stage-inner')!;
    const children = [...inner.children];
    const strips = container.querySelectorAll('.rack-pdu');
    expect(strips).toHaveLength(2);
    expect(children[0]).toHaveClass('rack-pdu-column');
    expect(children[0].querySelector('.rack-pdu')).toHaveAttribute('data-source', 'SUPPLIER');
    expect(children.at(-1)).toHaveClass('rack-pdu-column');
    expect(children.at(-1)!.querySelector('.rack-pdu')).toHaveAttribute('data-source', 'UPS');
    expect(container.querySelectorAll('.rack-face')).toHaveLength(view === 'both' ? 2 : 1);
  });

  it('shows no UPS strip on a supplier-only rack', () => {
    const { container } = render(<RackDetail rack={{ ...rack, pdus: [supplier] }} canEdit={false} onOut={vi.fn()} onDevice={vi.fn()} onPreviewPlacement={vi.fn()} onPlaceDevice={vi.fn()} onEditDevice={vi.fn()} />);
    expect([...container.querySelectorAll('.rack-pdu')].map((strip) => strip.getAttribute('data-source'))).toEqual(['SUPPLIER']);
  });

  it('shows the estimated total split per feed in the header', () => {
    renderRack('front');
    expect(screen.getByTestId('rack-power-summary')).toHaveTextContent('~600 W estimado (Rede ~400 W · UPS ~200 W)');
  });

  it('shows no strips or total for a rack without PDUs', () => {
    const { container } = render(<RackDetail rack={{ ...rack, pdus: [] }} canEdit={false} onOut={vi.fn()} onDevice={vi.fn()} onPreviewPlacement={vi.fn()} onPlaceDevice={vi.fn()} onEditDevice={vi.fn()} />);
    expect(container.querySelector('.rack-pdu')).toBeNull();
    expect(screen.queryByTestId('rack-power-summary')).toBeNull();
  });
});

const view = pduView(supplier, rack);
const renderStrip = (props: Partial<React.ComponentProps<typeof RackPduStrip>> = {}) => render(<RackPduStrip view={view} side="left" width={40} height={700} canDisconnect onDisconnect={vi.fn(async () => {})} {...props} />);

describe('RackPduStrip', () => {
  it('shows the used/total and estimated-watts badge with one marker per outlet', () => {
    const { container } = renderStrip();
    expect(container.querySelector('.rack-pdu-badge')).toHaveTextContent('3/32~400 W');
    expect(container.querySelectorAll('.rack-pdu-leds i')).toHaveLength(32);
    expect(container.querySelectorAll('.rack-pdu-leds i[data-used]')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /PDU A \(Rede\): 3 de 32 tomadas em uso/ })).toBeInTheDocument();
  });

  it('collapses to a thin bar when drawn narrow', () => {
    const { container } = renderStrip({ width: 12 });
    expect(container.querySelector('.rack-pdu')).toHaveClass('rack-pdu-compact');
    expect(container.querySelector('.rack-pdu-thin')).not.toBeNull();
    expect(container.querySelector('.rack-pdu img')).toBeNull();
  });

  it('opens its card on click with devices, outlets, watts and the failover line; Esc closes it', async () => {
    renderStrip();
    const strip = screen.getByRole('button', { name: /PDU A/ });
    fireEvent.click(strip);
    const card = await screen.findByRole('dialog', { name: 'PDU A · Rede' });
    expect(strip).toHaveAttribute('aria-expanded', 'true');
    expect(within(card).getByText('Server 1').closest('li')).toHaveTextContent('1 tomadas · 2 fontes~200 W');
    expect(within(card).getByText('Switch').closest('li')).toHaveTextContent('2 tomadas~200 W');
    expect(within(card).getByText('Se a outra fonte falhar: ~600 W')).toBeInTheDocument();
    expect(openPduCardBoxes()).toHaveLength(1);
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(strip).toHaveFocus();
    expect(openPduCardBoxes()).toHaveLength(0);
  });

  it('asks for an inline confirm before Desligar and calls back with the PDU and device', async () => {
    const onDisconnect = vi.fn(async () => {});
    renderStrip({ onDisconnect });
    fireEvent.click(screen.getByRole('button', { name: /PDU A/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Desligar Switch de PDU A' }));
    const confirm = screen.getByRole('group', { name: 'Desligar Switch de PDU A' });
    expect(confirm).toHaveTextContent('Liberta 2 tomada(s).');
    expect(onDisconnect).not.toHaveBeenCalled();
    // Esc inside the confirm only cancels the confirm.
    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Desligar Switch de PDU A' }));
    await act(async () => { fireEvent.click(within(screen.getByRole('group')).getByRole('button', { name: 'Desligar' })); });
    expect(onDisconnect).toHaveBeenCalledWith('pdu-s', 'sw');
  });

  it('is read-only without the operator role', async () => {
    renderStrip({ canDisconnect: false });
    fireEvent.click(screen.getByRole('button', { name: /PDU A/ }));
    const card = await screen.findByRole('dialog');
    expect(within(card).getByText('Só leitura')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /^Desligar/ })).toBeNull();
  });

  it('shows the error when Desligar fails and keeps the card open', async () => {
    renderStrip({ onDisconnect: vi.fn(async () => { throw new Error('nope'); }) });
    fireEvent.click(screen.getByRole('button', { name: /PDU A/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Desligar Server 1 de PDU A' }));
    await act(async () => { fireEvent.click(within(screen.getByRole('group')).getByRole('button', { name: 'Desligar' })); });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível desligar o equipamento.'));
  });
});

describe('shared card placement with PDUs', () => {
  it('counts the PDU strips as part of the racks box', () => {
    const stage = document.createElement('div');
    stage.className = 'rack-stage';
    const make = (className: string, left: number, right: number) => {
      const element = document.createElement('div');
      element.className = className;
      element.getBoundingClientRect = () => ({ left, right, top: 0, bottom: 800, width: right - left, height: 800, x: left, y: 0, toJSON() {} });
      stage.append(element);
      return element;
    };
    make('rack-pdu', 100, 140);
    const frame = make('rack-frame', 150, 450);
    make('rack-pdu', 460, 500);
    document.body.append(stage);
    expect(racksBox(frame).rack).toMatchObject({ left: 100, right: 500 });
    stage.remove();
  });

  it('steps a device card around an open PDU card on the same side', () => {
    const placement = placeHoverCard({
      device: { top: 300, bottom: 340, left: 150, right: 450 },
      rack: { top: 0, bottom: 800, left: 100, right: 500 },
      stage: { top: 0, bottom: 800, left: 0, right: 1600 },
      card: { width: 300, height: 200 },
      viewport: { width: 1600, height: 900 },
      prefer: 'right',
      avoid: [{ top: 250, bottom: 450, left: 514, right: 814 }],
    });
    expect(placement.side).toBe('right');
    expect(placement.left).toBe(828);
  });
});
