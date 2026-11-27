import { describe, expect, it } from 'vitest';
import { buildBookStackSearchUrl } from './bookstack';

describe('buildBookStackSearchUrl', () => {
  it('maps asset and service IDs to stable BookStack search terms', () => {
    expect(buildBookStackSearchUrl('https://docs.example.test/', 'asset', 'asset/42'))
      .toBe('https://docs.example.test/search?term=management-app%3Aasset%3Aasset%2F42');
    expect(buildBookStackSearchUrl('https://docs.example.test/manual', 'service', 'svc-123'))
      .toBe('https://docs.example.test/manual/search?term=management-app%3Aservice%3Asvc-123');
  });

  it('returns no link for missing or unsafe configuration', () => {
    expect(buildBookStackSearchUrl('', 'asset', 'a1')).toBeNull();
    expect(buildBookStackSearchUrl('javascript:alert(1)', 'service', 's1')).toBeNull();
    expect(buildBookStackSearchUrl('https://user:pass@example.test', 'asset', 'a1')).toBeNull();
    expect(buildBookStackSearchUrl('https://docs.example.test', 'asset', '')).toBeNull();
  });
});
