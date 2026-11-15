import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Device, Rack } from '../../types';
import { RackWorkspace } from './rack-workspace';

vi.mock('./rack-detail', () => ({ RackDetail: () => null }));
vi.mock('./rack-equipment-preview', () => ({ RackEquipmentPreview: () => null }));

afterEach(cleanup);

const racks: Rack[] = [
  { id: 'rack-a', name: 'Rack A', roomId: 'room-1', units: 42, devices: [] },
  { id: 'rack-b', name: 'Rack B', roomId: 'room-1', units: 42, devices: [] },
];

describe('RackWorkspace rack ordering', () => {
  const renderWorkspace = (items: Rack[]) => render(<RackWorkspace
    rooms={[]}
    roomId="room-1"
    buildingId="building-1"
    racks={items}
    allRoomRacks={items}
    unplacedDevices={[]}
    selected={undefined}
    setRack={vi.fn()}
    onOut={vi.fn()}
    onDevice={vi.fn()}
    onEdit={vi.fn()}
    deletingRackId=""
    canEdit={false}
    canReorderRacks={false}
    onPreviewPlacement={vi.fn()}
    onPlaceDevice={vi.fn()}
    onReorderRacks={vi.fn()}
    onEditDevice={vi.fn()}
  />);

  it('keeps a single rack as one usable, readable figure', () => {
    const { container } = renderWorkspace([racks[0]]);
    const figures = [...container.querySelectorAll('figure.rack-figure')];
    expect(figures).toHaveLength(1);
    expect(container.querySelector('.rack-figure-grid')).toHaveClass('single-rack');
    expect(figures[0].querySelector('figcaption strong')).toHaveTextContent('Rack A');
    expect(figures[0].querySelector('.rack-figure-image img')).toBeInTheDocument();
  });

  it('keeps multiple racks in their existing order and gives each a separate caption', () => {
    const additional = { id: 'rack-c', name: 'Rack C', roomId: 'room-1', units: 42, devices: [] } satisfies Rack;
    const { container } = renderWorkspace([...racks, additional]);
    expect(container.querySelector('.rack-figure-grid')).not.toHaveClass('single-rack');
    const captions = [...container.querySelectorAll('figure.rack-figure figcaption strong')].map((item) => item.textContent);
    expect(captions).toEqual(['Rack A', 'Rack B', 'Rack C']);
    expect(container.querySelectorAll('.rack-figure-image')).toHaveLength(3);
  });

  it('shows unplaced devices and exposes their drag payload when equipment reordering is enabled', () => {
    const unplacedDevice = { id: 'device-unplaced', name: 'Router awaiting placement', type: 'ROUTER', rackUnitSize: 2 } as Device;
    const { container, getByRole } = render(<RackWorkspace
      rooms={[]}
      roomId="room-1"
      buildingId="building-1"
      racks={[racks[0]]}
      allRoomRacks={racks}
      unplacedDevices={[unplacedDevice]}
      selected={undefined}
      setRack={vi.fn()}
      onOut={vi.fn()}
      onDevice={vi.fn()}
      onEdit={vi.fn()}
      deletingRackId=""
      canEdit
      onPreviewPlacement={vi.fn()}
      onPlaceDevice={vi.fn()}
      onReorderRacks={vi.fn()}
      onEditDevice={vi.fn()}
      canReorderRacks
    />);
    expect(container.querySelector('.rack-unplaced-shelf strong')).toHaveTextContent('Por localizar');
    const device = getByRole('button', { name: /Router awaiting placement/ });
    expect(device).toHaveAttribute('aria-disabled', 'true');
    expect((device as HTMLButtonElement).draggable).toBe(false);
    fireEvent.click(getByRole('button', { name: 'Reorganizar equipamentos' }));
    expect(device).toHaveAttribute('aria-disabled', 'false');
    expect((device as HTMLButtonElement).draggable).toBe(true);
    const setData = vi.fn();
    fireEvent.dragStart(device, { dataTransfer: { effectAllowed: '', setData } });
    expect(setData).toHaveBeenNthCalledWith(1, 'text/plain', 'device-unplaced');
    expect(setData).toHaveBeenNthCalledWith(2, 'application/x-device-id', 'device-unplaced');
    expect(setData).toHaveBeenNthCalledWith(3, 'application/x-device-size', '2');
    expect(container.querySelector('.rack-unplaced-shelf')).toBeInTheDocument();
  });

  it('retains rack ordering and creation actions alongside the restored unplaced shelf', () => {
    const { getByRole } = render(<RackWorkspace
      rooms={[]}
      roomId="room-1"
      buildingId="building-1"
      racks={[racks[0]]}
      allRoomRacks={racks}
      unplacedDevices={[]}
      selected={undefined}
      setRack={vi.fn()}
      onOut={vi.fn()}
      onDevice={vi.fn()}
      onEdit={vi.fn()}
      deletingRackId=""
      canEdit
      onPreviewPlacement={vi.fn()}
      onPlaceDevice={vi.fn()}
      onReorderRacks={vi.fn()}
      onEditDevice={vi.fn()}
      canReorderRacks
    />);
    expect(getByRole('button', { name: 'Reorganizar equipamentos' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Reordenar bastidores' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Adicionar bastidor' })).toBeInTheDocument();
  });

  it('saves a keyboard-reordered rack list through the rack-order callback', async () => {
    const onReorderRacks = vi.fn(async () => racks);
    const { getByRole } = render(<RackWorkspace
      rooms={[]}
      roomId="room-1"
      buildingId="building-1"
      racks={[racks[0]]}
      allRoomRacks={racks}
      unplacedDevices={[]}
      selected={undefined}
      setRack={vi.fn()}
      onOut={vi.fn()}
      onDevice={vi.fn()}
      onEdit={vi.fn()}
      deletingRackId=""
      canEdit={false}
      canReorderRacks
      onPreviewPlacement={vi.fn()}
      onPlaceDevice={vi.fn()}
      onReorderRacks={onReorderRacks}
      onEditDevice={vi.fn()}
    />);

    fireEvent.click(getByRole('button', { name: 'Reordenar bastidores' }));
    expect(getByRole('figure', { name: 'Reordenar bastidor Rack B' })).toBeInTheDocument();
    fireEvent.keyDown(getByRole('figure', { name: 'Reordenar bastidor Rack A' }), { key: 'ArrowRight' });
    fireEvent.click(getByRole('button', { name: 'Guardar ordem' }));

    await waitFor(() => expect(onReorderRacks).toHaveBeenCalledWith('room-1', ['rack-b', 'rack-a']));
  });
});
