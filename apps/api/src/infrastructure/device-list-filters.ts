import { BadRequestException } from '@nestjs/common';
import { AssetStatus, Prisma } from '@simoes/database';

export const DEVICE_STATUSES = Object.values(AssetStatus);

export type DeviceListFilterInput = {
  status?: string;
  critical?: string;
  lifecycle?: string;
  lifecycleKind?: string;
  tier?: string;
};

function invalid(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}

function startOfUtcDay(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Optional Dashboard drill-through filters for GET /devices. Every filter is additive (AND) and
 * omitted filters keep the previous behaviour.
 * - status: comma list of AssetStatus values.
 * - critical: true | false.
 * - lifecycle: overdue (a lifecycle date before today) or due:<days> (due between today and today + days, 1..3650).
 * - lifecycleKind: restricts the lifecycle match to one kind (e.g. SUPPORT, WARRANTY).
 * - tier: comma list of criticality tiers (T1, T2, T3); devices without a tier never match.
 */
export function deviceListFilterWhere(input: DeviceListFilterInput, now = new Date()): Prisma.DeviceWhereInput[] {
  const where: Prisma.DeviceWhereInput[] = [];
  if (input.status !== undefined && input.status !== '') {
    const statuses = [...new Set(input.status.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean))];
    if (!statuses.length || statuses.some((value) => !(DEVICE_STATUSES as string[]).includes(value))) invalid('DEVICE_STATUS_FILTER_INVALID', `Estado inválido. Usa ${DEVICE_STATUSES.join(', ')}.`);
    where.push({ status: { in: statuses as AssetStatus[] } });
  }
  if (input.critical !== undefined && input.critical !== '') {
    if (input.critical !== 'true' && input.critical !== 'false') invalid('DEVICE_CRITICAL_FILTER_INVALID', 'critical deve ser true ou false.');
    where.push({ isCritical: input.critical === 'true' });
  }
  if (input.tier !== undefined && input.tier !== '') {
    const tiers = [...new Set(input.tier.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean))];
    if (!tiers.length || tiers.some((value) => !['T1', 'T2', 'T3'].includes(value))) invalid('DEVICE_TIER_FILTER_INVALID', 'tier deve ser T1, T2 ou T3.');
    where.push({ criticalityTier: { in: tiers as ('T1' | 'T2' | 'T3')[] } });
  }
  const kind = input.lifecycleKind?.trim();
  if (input.lifecycle !== undefined && input.lifecycle !== '') {
    const today = startOfUtcDay(now);
    const value = input.lifecycle.trim().toLowerCase();
    let dueDate: Prisma.DateTimeFilter;
    if (value === 'overdue') dueDate = { lt: today };
    else {
      const match = /^due:(\d{1,4})$/.exec(value);
      const days = match ? Number(match[1]) : NaN;
      if (!Number.isInteger(days) || days < 1 || days > 3650) invalid('DEVICE_LIFECYCLE_FILTER_INVALID', 'lifecycle deve ser overdue ou due:<dias> (1 a 3650).');
      dueDate = { gte: today, lte: new Date(today.getTime() + days * 24 * 60 * 60 * 1000) };
    }
    where.push({ lifecycleDates: { some: { dueDate, ...(kind ? { kind } : {}) } } });
  } else if (kind) {
    where.push({ lifecycleDates: { some: { kind } } });
  }
  return where;
}

/** Devices per criticality tier for the list header; `none` counts devices without a tier. */
export function tierCountsOf(groups: Array<{ criticalityTier: string | null; _count: { _all: number } }>) {
  const counts = { T1: 0, T2: 0, T3: 0, none: 0 };
  for (const group of groups) {
    const key = group.criticalityTier === 'T1' || group.criticalityTier === 'T2' || group.criticalityTier === 'T3' ? group.criticalityTier : 'none';
    counts[key] += group._count._all;
  }
  return counts;
}
