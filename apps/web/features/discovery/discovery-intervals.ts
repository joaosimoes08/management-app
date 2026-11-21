/**
 * Discovery interval choices. The API accepts any whole number of hours from 1 to 168
 * (apps/api/src/settings/dto.ts intervalHours and apps/api/src/ipam/dto.ts schedule
 * intervalHours: @IsInt() @Min(1) @Max(168)); this list stays inside that range.
 */
export const DISCOVERY_INTERVAL_MIN_HOURS = 1;
export const DISCOVERY_INTERVAL_MAX_HOURS = 168;
export const discoveryIntervalOptions = [1, 2, 4, 6, 8, 12, 24, 48, 72, 168] as const;

export function formatDiscoveryInterval(hours: number) {
  if (hours < 24 || hours % 24 !== 0) return `${hours} h`;
  const days = hours / 24;
  return `${days} dia${days > 1 ? 's' : ''}`;
}

/** Options to render for a select, keeping a saved value that is valid for the API but not in the list. */
export function discoveryIntervalChoices(current?: number): number[] {
  const options: number[] = [...discoveryIntervalOptions];
  if (current !== undefined && Number.isInteger(current) && current >= DISCOVERY_INTERVAL_MIN_HOURS && current <= DISCOVERY_INTERVAL_MAX_HOURS && !options.includes(current)) {
    options.push(current);
    options.sort((a, b) => a - b);
  }
  return options;
}
