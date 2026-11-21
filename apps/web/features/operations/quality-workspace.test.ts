import { describe, expect, it } from 'vitest';
import type { BulkFindingResponse, FindingFacets, InventoryFinding } from './api';
import { ALL, bulkOutcome, emptyQualityFilters, findingQueryFrom, groupByRule, hasQualityFilters, snoozeOptions, statusCount, visibleSelection } from './quality-workspace';

const finding = (id: string, rule: string, status: InventoryFinding['status'] = 'OPEN') => ({ id, rule, status, title: `T ${id}` }) as InventoryFinding;

describe('quality workspace helpers', () => {
  it('maps URL filters to the API query, dropping ALL and unknown values', () => {
    expect(findingQueryFrom('s1', '  core ', { ...emptyQualityFilters, assignee: 'me', rule: 'DEVICE_MISSING_SITE' })).toEqual({ siteId: 's1', status: 'OPEN', severity: undefined, rule: 'DEVICE_MISSING_SITE', search: 'core', assignee: 'me' });
    expect(findingQueryFrom('s1', '', { ...emptyQualityFilters, status: ALL, severity: 'BOGUS' })).toMatchObject({ status: undefined, severity: undefined, search: undefined });
  });

  it('treats the status tab and grouping as views, not filters', () => {
    expect(hasQualityFilters('', { ...emptyQualityFilters, status: 'RESOLVED', group: 'rule' })).toBe(false);
    expect(hasQualityFilters('', { ...emptyQualityFilters, assignee: 'unassigned' })).toBe(true);
  });

  it('groups by rule in the incoming order', () => {
    const groups = groupByRule([finding('1', 'B'), finding('2', 'A'), finding('3', 'B')]);
    expect(groups.map((group) => [group.rule, group.rows.map((row) => row.id)])).toEqual([['B', ['1', '3']], ['A', ['2']]]);
  });

  it('keeps only visible, actionable selections', () => {
    const rows = [finding('1', 'A'), finding('2', 'A', 'RESOLVED')];
    expect(visibleSelection(new Set(['1', '2', 'hidden']), rows)).toEqual(['1']);
  });

  it('offers the agreed snooze lengths in hours', () => {
    expect(snoozeOptions.map((option) => option.hours)).toEqual([1, 4, 24, 72, 168, 720]);
  });

  it('sums the status counts for the Todos tab', () => {
    const facets = { total: 9, byStatus: { OPEN: 4, SNOOZED: 2, RESOLVED: 3 }, bySeverity: {}, byRule: [], byAssignee: [] } as FindingFacets;
    expect(statusCount(facets, ALL)).toBe(9);
    expect(statusCount(facets, 'ACKNOWLEDGED')).toBe(0);
    expect(statusCount(undefined, 'OPEN')).toBe(0);
  });

  it('labels per-item bulk results with titles and readable failures', () => {
    const response: BulkFindingResponse = { action: 'SNOOZE', succeeded: 1, failed: 2, snoozedUntil: '2026-11-22T10:00:00.000Z', results: [{ id: 'a', ok: true }, { id: 'b', ok: false, code: 'FORBIDDEN', message: 'nope' }, { id: 'zz', ok: false, code: 'NOT_FOUND' }] };
    const outcome = bulkOutcome(response, new Map([['a', 'Alpha'], ['b', 'Beta']]));
    expect(outcome.items).toEqual([
      { id: 'a', title: 'Alpha', ok: true, message: 'Aplicado' },
      { id: 'b', title: 'Beta', ok: false, message: 'Sem permissão neste Site' },
      { id: 'zz', title: 'zz', ok: false, message: 'Não encontrado ou sem acesso' },
    ]);
    expect(outcome.snoozedUntil).toBe('2026-11-22T10:00:00.000Z');
  });
});
