import { describe, expect, it } from 'vitest';
import { assetsPageUrl, criticalAssetsKeys } from './api';
import { emptyFilters, NO_OUTCOME, NO_OWNER } from './workbench';

describe('critical-assets api', () => {
  it('keeps every query under the prefixes the page refreshes', () => {
    expect(criticalAssetsKeys.list('s1').slice(0, 1)).toEqual(criticalAssetsKeys.all);
    expect(criticalAssetsKeys.page('s1', emptyFilters, '', 1).slice(0, 1)).toEqual(criticalAssetsKeys.all);
    expect(criticalAssetsKeys.corrections('s1').slice(0, 1)).toEqual(criticalAssetsKeys.correctionsAll);
  });

  it('sends the table filters to the paged endpoint, with NONE for "no owner" and "no review"', () => {
    const url = assetsPageUrl('s 1', { ...emptyFilters, owner: NO_OWNER, outcome: NO_OUTCOME, type: 'SWITCH' }, '  core ', 2, 50);
    expect(url).toBe('/api/v1/critical-assets/assets?siteId=s+1&page=2&pageSize=50&q=core&type=SWITCH&owner=NONE&outcome=NONE');
  });
});
