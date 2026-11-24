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

  it('ignores URL and stored placeholders such as a literal hash', () => {
    expect(resolveActiveSite(sites, '#', null)).toBe('');
    expect(resolveActiveSite(sites, null, '#')).toBe('');
  });

  it('accepts accessible UUID site IDs', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(resolveActiveSite([{ id }], id, null)).toBe(id);
  });
});

describe('siteUrl', () => {
  it('changes Site without a reload and clears descendant scopes', () => {
    expect(siteUrl('/infraestrutura', '?siteId=old&buildingId=b&roomId=r&rackId=k&tab=racks', 'lx'))
      .toBe('/infraestrutura?siteId=lx&tab=racks');
  });
});
