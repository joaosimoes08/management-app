import type { Prisma } from '@simoes/database';

/** Round 2 #18: a reservation holds U-space while it is not released and has not expired. */
export function activeReservationWhere(now: Date): Prisma.RackUnitReservationWhereInput {
  return { releasedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

export type UnitSpan = { startUnit: number; size: number };

/** Units 1..rackUnits covered by the span (clipped to the rack). */
export function spanUnits(span: UnitSpan, rackUnits: number) {
  const units: number[] = [];
  const end = Math.min(rackUnits, span.startUnit + span.size - 1);
  for (let unit = Math.max(1, span.startUnit); unit <= end; unit++) units.push(unit);
  return units;
}

export function spansOverlap(a: UnitSpan, b: UnitSpan) {
  return a.startUnit <= b.startUnit + b.size - 1 && b.startUnit <= a.startUnit + a.size - 1;
}

/** Space reserved for planned installs that no device occupies yet, and the union of both. */
export function rackSpaceUsage(rackUnits: number, devices: { rackUnitStart: number | null; rackUnitSize: number | null }[], reservations: UnitSpan[]) {
  const occupied = new Set<number>();
  for (const device of devices) {
    if (!device.rackUnitStart || !device.rackUnitSize) continue;
    for (const unit of spanUnits({ startUnit: device.rackUnitStart, size: device.rackUnitSize }, rackUnits)) occupied.add(unit);
  }
  const used = new Set(occupied);
  let reserved = 0;
  for (const reservation of reservations) {
    for (const unit of spanUnits(reservation, rackUnits)) if (!used.has(unit)) { used.add(unit); reserved++; }
  }
  return { occupied: occupied.size, reserved, used: used.size };
}
