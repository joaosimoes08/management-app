import { describe, expect, it } from 'vitest';
import { applyChipFilters, chipOptions, CHIP_NONE, countBy, facetCounts, matchesChipFilters, nextChipValue, totalOf, type ChipAccessors } from './filter-chips';

type Row = { id: number; status: string; type: string | null };
const rows: Row[] = [
  { id: 1, status: 'ACTIVE', type: 'SWITCH' },
  { id: 2, status: 'ACTIVE', type: 'ROUTER' },
  { id: 3, status: 'INACTIVE', type: 'SWITCH' },
  { id: 4, status: 'MAINTENANCE', type: null },
];
const accessors: ChipAccessors<Row> = { status: (row) => row.status, type: (row) => row.type };

describe('countBy', () => {
  it('counts rows per value and puts empty values under CHIP_NONE', () => {
    expect(countBy(rows, (row) => row.type)).toEqual({ SWITCH: 2, ROUTER: 1, [CHIP_NONE]: 1 });
    expect(countBy([], (row: Row) => row.status)).toEqual({});
  });
});

describe('matchesChipFilters / applyChipFilters', () => {
  it('treats empty filters as "all"', () => {
    expect(applyChipFilters(rows, { status: '', type: '' }, accessors)).toHaveLength(4);
    expect(applyChipFilters(rows, {}, accessors)).toHaveLength(4);
  });

  it('combines dimensions with AND', () => {
    expect(applyChipFilters(rows, { status: 'ACTIVE', type: 'SWITCH' }, accessors).map((row) => row.id)).toEqual([1]);
    expect(applyChipFilters(rows, { status: 'INACTIVE', type: 'ROUTER' }, accessors)).toEqual([]);
  });

  it('matches empty values with CHIP_NONE', () => {
    expect(applyChipFilters(rows, { type: CHIP_NONE }, accessors).map((row) => row.id)).toEqual([4]);
  });

  it('ignores filters without an accessor and can skip one dimension', () => {
    expect(matchesChipFilters(rows[0]!, { other: 'x' }, accessors)).toBe(true);
    expect(matchesChipFilters(rows[0]!, { status: 'INACTIVE' }, accessors, 'status')).toBe(true);
  });

  it('works on rows a search already narrowed (filters combine with search)', () => {
    const searched = rows.filter((row) => row.type === 'SWITCH');
    expect(applyChipFilters(searched, { status: 'ACTIVE' }, accessors).map((row) => row.id)).toEqual([1]);
  });
});

describe('facetCounts', () => {
  it('applies every other filter but not the dimension itself', () => {
    expect(facetCounts(rows, { status: 'ACTIVE', type: '' }, accessors, 'type')).toEqual({ SWITCH: 1, ROUTER: 1 });
    expect(facetCounts(rows, { status: 'ACTIVE', type: 'SWITCH' }, accessors, 'status')).toEqual({ ACTIVE: 1, INACTIVE: 1 });
  });

  it('returns no counts for an unknown dimension', () => {
    expect(facetCounts(rows, {}, accessors, 'missing')).toEqual({});
  });
});

describe('totalOf', () => {
  it('sums the counts, or only the listed values', () => {
    expect(totalOf({ a: 2, b: 3 })).toBe(5);
    expect(totalOf({ a: 2, b: 3, c: 10 }, ['a', 'b'])).toBe(5);
  });

  it('is undefined while a count is unknown', () => {
    expect(totalOf({ a: 2, b: undefined })).toBeUndefined();
    expect(totalOf({ a: 2 }, ['a', 'b'])).toBeUndefined();
  });
});

describe('chipOptions', () => {
  const labels = [['ACTIVE', 'Ativo'], ['INACTIVE', 'Inativo'], ['RETIRED', 'Retirado']] as const;

  it('keeps the label order and attaches counts', () => {
    expect(chipOptions(labels, { INACTIVE: 1, ACTIVE: 2 })).toEqual([
      { value: 'ACTIVE', label: 'Ativo', count: 2 },
      { value: 'INACTIVE', label: 'Inativo', count: 1 },
      { value: 'RETIRED', label: 'Retirado', count: undefined },
    ]);
  });

  it('counts missing values as 0 when the counts are complete', () => {
    expect(chipOptions(labels, { ACTIVE: 2 }, { complete: true }).map((option) => option.count)).toEqual([2, 0, 0]);
    expect(chipOptions(labels, { ACTIVE: 2 }, { complete: true, hideEmpty: true }).map((option) => option.value)).toEqual(['ACTIVE']);
  });

  it('appends values present in the data but not labelled, sorted', () => {
    const options = chipOptions(labels, { ACTIVE: 1, ZED: 1, BETA: 2, EMPTY: 0, '': 4 }, { extraLabel: (value) => value.toLowerCase() });
    expect(options.slice(3)).toEqual([{ value: 'BETA', label: 'beta', count: 2 }, { value: 'ZED', label: 'zed', count: 1 }]);
  });

  it('hides zero-count chips with hideEmpty, except the selected one and unknown counts', () => {
    const options = chipOptions(labels, { ACTIVE: 3, INACTIVE: 0, RETIRED: 0 }, { hideEmpty: true, selected: 'RETIRED' });
    expect(options.map((option) => option.value)).toEqual(['ACTIVE', 'RETIRED']);
    expect(chipOptions(labels, {}, { hideEmpty: true })).toHaveLength(3);
  });

  it('adds a chip for a selected value no label covers, so a link filter can be seen and cleared', () => {
    const options = chipOptions(labels, { ACTIVE: 3 }, { selected: 'ACTIVE,MAINTENANCE', extraLabel: () => 'Ativo, Em manutenção' });
    expect(options.at(-1)).toEqual({ value: 'ACTIVE,MAINTENANCE', label: 'Ativo, Em manutenção', count: undefined });
  });
});

describe('nextChipValue', () => {
  it('selects a chip, and clicking the selected chip goes back to all', () => {
    expect(nextChipValue('', 'ACTIVE')).toBe('ACTIVE');
    expect(nextChipValue('INACTIVE', 'ACTIVE')).toBe('ACTIVE');
    expect(nextChipValue('ACTIVE', 'ACTIVE')).toBe('');
  });
});
