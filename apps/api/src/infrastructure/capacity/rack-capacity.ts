import type { Prisma, PrismaClient } from '@simoes/database';
import { RACK_POWER_PDU_INCLUDE } from '../power/rack-power.service';
import { summarizeRackPower } from '../power/rack-power';

const rackCapacitySelect = {
  id: true, name: true, units: true, roomId: true,
  room: { select: { buildingId: true } },
  pdus: { include: RACK_POWER_PDU_INCLUDE },
  devices: {
    where: { status: { not: 'RETIRED' } },
    select: {
      id: true, name: true, type: true, rackUnitStart: true, rackUnitSize: true,
      powerPlugCount: true, estimatedWatts: true,
      model: { select: { powerPlugCount: true, typicalWatts: true, maxWatts: true } },
    },
  },
} satisfies Prisma.RackSelect;

export function readCapacityRacks(prisma: PrismaClient, where: Prisma.RackWhereInput, page?: { after?: string; take: number }) {
  return prisma.rack.findMany({
    where: page?.after ? { AND: [where, { id: { gt: page.after } }] } : where,
    select: rackCapacitySelect,
    orderBy: { id: 'asc' },
    take: page?.take,
  });
}

export type CapacityRack = Awaited<ReturnType<typeof readCapacityRacks>>[number];

export function rackMeasurements(rack: CapacityRack) {
  const occupied = new Set<number>();
  for (const device of rack.devices) {
    if (!device.rackUnitStart || !device.rackUnitSize) continue;
    const end = Math.min(rack.units, device.rackUnitStart + device.rackUnitSize - 1);
    for (let unit = Math.max(1, device.rackUnitStart); unit <= end; unit++) occupied.add(unit);
  }
  const power = summarizeRackPower(rack.pdus, rack.devices);
  const rackBudget = power.pdus.length && power.pdus.every((pdu) => pdu.budgetWatts !== null)
    ? power.pdus.reduce((sum, pdu) => sum + (pdu.budgetWatts ?? 0), 0)
    : null;
  return [
    { kind: 'RACK_SPACE' as const, resourceKey: 'space', name: rack.name, source: null, used: occupied.size, total: rack.units },
    { kind: 'RACK_POWER' as const, resourceKey: 'power', name: rack.name, source: null, used: power.totals.estimatedWatts, total: rackBudget },
    ...power.pdus.map((pdu) => ({
      kind: 'PDU_POWER' as const, resourceKey: `pdu:${pdu.id}`,
      name: pdu.name ?? '', source: pdu.source,
      used: pdu.estimatedWatts, total: pdu.budgetWatts,
    })),
  ];
}
