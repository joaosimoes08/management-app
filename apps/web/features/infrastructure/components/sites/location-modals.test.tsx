import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildingModal } from './building-modal';
import { RoomModal } from './room-modal';

afterEach(cleanup);

describe('infrastructure location editors', () => {
  it('submits an edited building with its existing name and description', () => {
    const save = vi.fn();
    render(<BuildingModal modal editing close={vi.fn()} buildingForm={{ name: 'North', description: 'Campus A' }} setBuildingForm={vi.fn()} createBuilding={save} />);

    expect(screen.getByRole('heading', { name: 'Editar edifício' })).toBeTruthy();
    expect(screen.getByLabelText('Nome do edifício')).toHaveValue('North');
    expect(screen.getByLabelText('Localização / descrição')).toHaveValue('Campus A');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar alterações' }));
    expect(save).toHaveBeenCalledOnce();
  });

  it('submits an edited room while keeping it in its current building', () => {
    const save = vi.fn();
    render(<RoomModal modal editing close={vi.fn()} roomForm={{ name: 'Server room', buildingId: 'building-1' }} setRoomForm={vi.fn()} buildings={[{ id: 'building-1', name: 'North' }]} createRoom={save} />);

    expect(screen.getByRole('heading', { name: 'Editar sala' })).toBeTruthy();
    expect(screen.getByLabelText('Nome da sala')).toHaveValue('Server room');
    expect(screen.getByLabelText('Edifício')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar alterações' }));
    expect(save).toHaveBeenCalledOnce();
  });
});
