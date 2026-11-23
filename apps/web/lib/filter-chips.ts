/**
 * Pure helpers behind the FilterChips buttons: counting rows per value,
 * applying several chip filters at once and building the chip list.
 * No React here, so it is easy to unit test.
 *
 * A chip filter value of '' means "all". Filters across dimensions combine
 * with AND; a page's own search is applied before these helpers see the rows.
 */

export type ChipValue = string | null | undefined;
/** One reader per filter dimension: returns the row's value for that dimension. */
export type ChipAccessors<Row> = Record<string, (row: Row) => ChipValue>;
export type ChipOption = { value: string; label: string; count: number | undefined };

/** Value used for rows whose dimension is empty (null, undefined or ''). */
export const CHIP_NONE = '__none__';

const chipKey = (value: ChipValue) => (value === null || value === undefined || value === '' ? CHIP_NONE : value);

/** Number of rows per value of one dimension. Empty values count under CHIP_NONE. */
export function countBy<Row>(rows: readonly Row[], valueOf: (row: Row) => ChipValue): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = chipKey(valueOf(row));
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** True when the row matches every active filter. Filters without an accessor are ignored. */
export function matchesChipFilters<Row>(row: Row, filters: Readonly<Record<string, string>>, accessors: ChipAccessors<Row>, skip?: string): boolean {
  for (const [key, valueOf] of Object.entries(accessors)) {
    if (key === skip) continue;
    const wanted = filters[key] ?? '';
    if (wanted && chipKey(valueOf(row)) !== wanted) return false;
  }
  return true;
}

/** Rows matching every active chip filter. */
export function applyChipFilters<Row>(rows: readonly Row[], filters: Readonly<Record<string, string>>, accessors: ChipAccessors<Row>): Row[] {
  return rows.filter((row) => matchesChipFilters(row, filters, accessors));
}

/**
 * Counts for one dimension with every *other* active filter applied, so each
 * chip says how many rows you get if you pick it next.
 */
export function facetCounts<Row>(rows: readonly Row[], filters: Readonly<Record<string, string>>, accessors: ChipAccessors<Row>, dimension: string): Record<string, number> {
  const valueOf = accessors[dimension];
  if (!valueOf) return {};
  return countBy(rows.filter((row) => matchesChipFilters(row, filters, accessors, dimension)), valueOf);
}

/** Sum of the known counts; undefined while any count is still unknown. */
export function totalOf(counts: Readonly<Record<string, number | undefined>>, values?: readonly string[]): number | undefined {
  const keys = values ?? Object.keys(counts);
  let total = 0;
  for (const key of keys) {
    const count = counts[key];
    if (count === undefined) return undefined;
    total += count;
  }
  return total;
}

/**
 * Chips in the given order with their counts. Values not in `labels` but
 * present in the data, or selected, are appended (raw value as label), so nothing is hidden.
 * With `hideEmpty`, zero-count chips are dropped unless they are selected.
 * With `complete` (counts made from every row, e.g. by countBy), a missing value counts as 0, not unknown.
 */
export function chipOptions(labels: ReadonlyArray<readonly [string, string]>, counts: Readonly<Record<string, number | undefined>>, options: { selected?: string; hideEmpty?: boolean; extraLabel?: (value: string) => string; complete?: boolean } = {}): ChipOption[] {
  const known = new Set(labels.map(([value]) => value));
  const extras = Object.keys(counts).filter((value) => value !== '' && !known.has(value) && (counts[value] ?? 0) > 0).sort();
  // A value from a link that no chip covers (e.g. `status=ACTIVE,MAINTENANCE`) still gets a chip, so it can be seen and cleared.
  if (options.selected && !known.has(options.selected) && !extras.includes(options.selected)) extras.push(options.selected);
  const all: ChipOption[] = [
    ...labels.map(([value, label]) => ({ value, label, count: counts[value] ?? (options.complete ? 0 : undefined) })),
    ...extras.map((value) => ({ value, label: options.extraLabel?.(value) ?? value, count: counts[value] ?? (options.complete ? 0 : undefined) })),
  ];
  return options.hideEmpty ? all.filter((option) => option.value === options.selected || option.count === undefined || option.count > 0) : all;
}

/** Clicking the selected chip clears the filter; any other chip selects it. */
export const nextChipValue = (current: string, clicked: string) => (current === clicked ? '' : clicked);
