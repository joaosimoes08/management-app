import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Rack } from '../../types';
import { RackWorkspace } from './rack-workspace';

vi.mock('./rack-detail', () => ({ RackDetail: () => null }));
vi.mock('./rack-equipment-preview', () => ({ RackEquipmentPreview: () => null }));

afterEach(cleanup);

const racks: Rack[] = [
  { id: 'rack-a', name: 'Rack A', roomId: 'room-1', units: 42, devices: [] },
  { id: 'rack-b', name: 'Rack B', roomId: 'room-1', units: 42, devices: [] },
];

describe('RackWorkspace rack ordering', () => {
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
