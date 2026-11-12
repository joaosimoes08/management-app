import { afterEach, describe, expect, it } from 'vitest';
import { getConfiguredLocale, getPublicOrganizationName, getPublicRuntimeConfig } from './runtime-config';

describe('public runtime branding configuration', () => {
  afterEach(() => { delete window.__COCIBER_CONFIG__; });

  it('uses deployment branding and locale when configured', () => {
    window.__COCIBER_CONFIG__ = { keycloakRealm: 'SIMONEDA', organizationName: 'SIMONEDA', locale: 'en-US' };
    expect(getPublicOrganizationName()).toBe('SIMONEDA');
    expect(getConfiguredLocale()).toBe('en-US');
  });

  it('falls back to the realm name and Portuguese locale', () => {
    window.__COCIBER_CONFIG__ = { keycloakRealm: 'SIMONEDA', locale: 'fr-FR' };
    expect(getPublicOrganizationName()).toBe('SIMONEDA');
    expect(getConfiguredLocale()).toBe('pt-PT');
    expect(getPublicRuntimeConfig().keycloakRealm).toBe('SIMONEDA');
  });

  it('preserves existing default branding and locale when no deployment values are supplied', () => {
    window.__COCIBER_CONFIG__ = {};
    expect(getPublicOrganizationName()).toBe('COCiber');
    expect(getConfiguredLocale()).toBe('pt-PT');
  });
});
