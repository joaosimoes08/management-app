import { describe, expect, it } from 'vitest';
import { resolveActiveSite, siteUrl } from './site-selection';

const sites = [{ id: 'lx' }, { id: 'pt' }];

describe('resolveActiveSite', () => {
  it('selects the only accessible Site for Lara', () => {
    expect(resolveActiveSite([{ id: 'lx' }], null, null)).toBe('lx');
  });

  it('uses URL before localStorage and ignores inaccessible Sites', () => {
    expect(resolveActiveSite(sites, 'pt', 'lx')).toBe('pt');
    expect(resolveActiveSite([{ id: 'lx' }], 'pt', 'lx')).toBe('lx');
  });

  it('keeps aggregate selection only when multiple Sites are accessible', () => {
    expect(resolveActiveSite(sites, null, null)).toBe('');
  });
});

describe('siteUrl', () => {
  it('changes Site without a reload and clears descendant scopes', () => {
    expect(siteUrl('/infraestrutura', '?siteId=old&buildingId=b&roomId=r&rackId=k&tab=racks', 'lx'))
      .toBe('/infraestrutura?siteId=lx&tab=racks');
  });
});
