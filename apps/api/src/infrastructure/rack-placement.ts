export type RackPlacementDevice = {
  id: string;
  name: string;
  rackId: string;
  rackUnitStart: number;
  rackUnitSize: number;
};

export type RackPlacementRack = {
  id: string;
  name: string;
  units: number;
  devices: RackPlacementDevice[];
};

export type RackPlacementChange = RackPlacementDevice & {
  rackName: string;
  reason: 'MOVED' | 'DISPLACED' | 'SWAPPED';
};

export type RackPlacementPlan = {
  changes: RackPlacementChange[];
  target: RackPlacementChange;
};

const overlaps = (left: RackPlacementDevice, right: RackPlacementDevice) => {
  const leftEnd = left.rackUnitStart + left.rackUnitSize - 1;
  const rightEnd = right.rackUnitStart + right.rackUnitSize - 1;
  return left.rackUnitStart <= rightEnd && leftEnd >= right.rackUnitStart;
};

const fits = (device: RackPlacementDevice, rack: RackPlacementRack, placed: RackPlacementDevice[]) => (
  device.rackUnitStart >= 1
  && device.rackUnitStart + device.rackUnitSize - 1 <= rack.units
  && !placed.some((item) => item.rackId === device.rackId && item.id !== device.id && overlaps(item, device))
);

/**
 * Produces the complete, deterministic set of rack-location changes for a drop.
 * The dragged device owns the requested U. A device below it is displaced by
 * its own height; when that slot is unavailable, the two devices swap places.
 */
export function planRackPlacement(
  racks: RackPlacementRack[],
  deviceId: string,
  targetRackId: string,
  targetRackUnitStart: number,
): RackPlacementPlan {
  const targetRack = racks.find((rack) => rack.id === targetRackId);
  if (!targetRack) throw new Error('Bastidor de destino não encontrado');

  const allDevices = racks.flatMap((rack) => rack.devices);
  const moving = allDevices.find((device) => device.id === deviceId);
  if (!moving) throw new Error('Equipamento não encontrado');
  if (!Number.isInteger(targetRackUnitStart)) throw new Error('A unidade de destino é inválida');

  const maximumStart = targetRack.units - moving.rackUnitSize + 1;
  if (maximumStart < 1) throw new Error('O equipamento não cabe no bastidor de destino');
  const snappedStart = Math.max(1, Math.min(maximumStart, targetRackUnitStart));
  const nextMoving = { ...moving, rackId: targetRackId, rackUnitStart: snappedStart };
  const remaining = allDevices.filter((device) => device.id !== moving.id);
  const collided = remaining.filter((device) => device.rackId === targetRackId && overlaps(device, nextMoving));

  if (!collided.length) {
    const target = { ...nextMoving, rackName: targetRack.name, reason: 'MOVED' as const };
    return { changes: [target], target };
  }

  const displaced: RackPlacementChange[] = [];
  const withoutCollided = remaining.filter((device) => !collided.some((item) => item.id === device.id));
  const occupied = [...withoutCollided, nextMoving];
  let canDisplace = true;
  for (const device of collided.sort((a, b) => a.rackUnitStart - b.rackUnitStart)) {
    const candidate = { ...device, rackUnitStart: device.rackUnitStart - device.rackUnitSize };
    if (!fits(candidate, targetRack, occupied)) {
      canDisplace = false;
      break;
    }
    occupied.push(candidate);
    displaced.push({ ...candidate, rackName: targetRack.name, reason: 'DISPLACED' });
  }

  if (canDisplace) {
    const target = { ...nextMoving, rackName: targetRack.name, reason: 'MOVED' as const };
    return { changes: [target, ...displaced], target };
  }

  if (collided.length !== 1) throw new Error('Não existe espaço para resolver esta sobreposição');
  const sourceRack = racks.find((rack) => rack.id === moving.rackId);
  if (!sourceRack) throw new Error('Bastidor de origem não encontrado');
  const swapped = { ...collided[0], rackId: moving.rackId, rackUnitStart: moving.rackUnitStart };
  const occupiedForSwap = [...withoutCollided.filter((device) => device.id !== moving.id), nextMoving];
  if (!fits(swapped, sourceRack, occupiedForSwap)) throw new Error('Não existe espaço para trocar os equipamentos');

  const target = { ...nextMoving, rackName: targetRack.name, reason: 'MOVED' as const };
  return {
    target,
    changes: [
      target,
      { ...swapped, rackName: sourceRack.name, reason: 'SWAPPED' },
    ],
  };
}
