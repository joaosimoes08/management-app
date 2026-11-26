import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfiguredLocale, getPublicOrganizationName, getPublicRuntimeConfig, hasSavedOrganizationLocale, resolveOrganizationLocale } from './runtime-config';

describe('public runtime branding configuration', () => {
  afterEach(() => { delete window.__CIVERNODE_CONFIG__; vi.unstubAllEnvs(); });

  it('keeps the direct API port for local development', () => {
    expect(getPublicRuntimeConfig().apiUrl).toBe('http://localhost:3001');
  });

  it('uses a same-origin API for production hosts when no API URL is configured', () => {
    const originalLocation = window.location;
    try {
      Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, hostname: 'management.example.com' } });
      window.__CIVERNODE_CONFIG__ = {};

      expect(getPublicRuntimeConfig().apiUrl).toBe('');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    }
  });

  it('honors an explicitly configured API URL', () => {
    window.__CIVERNODE_CONFIG__ = { apiUrl: 'https://api.example.com' };
    expect(getPublicRuntimeConfig().apiUrl).toBe('https://api.example.com');
  });

  it('uses deployment branding and locale when configured', () => {
    window.__CIVERNODE_CONFIG__ = { keycloakRealm: 'SIMONEDA', organizationName: 'SIMONEDA', locale: 'en-US' };
    expect(getPublicOrganizationName()).toBe('SIMONEDA');
    expect(getConfiguredLocale()).toBe('en-US');
  });

  it('never uses the realm as the organization name and falls back to Portuguese locale', () => {
    window.__CIVERNODE_CONFIG__ = { keycloakRealm: 'SIMONEDA', locale: 'fr-FR' };
    expect(getPublicOrganizationName()).toBe('Civernode');
    expect(getConfiguredLocale()).toBe('pt-PT');
    expect(getPublicRuntimeConfig().keycloakRealm).toBe('SIMONEDA');
  });

  it('preserves existing default branding and locale when no deployment values are supplied', () => {
    window.__CIVERNODE_CONFIG__ = {};
    expect(getPublicOrganizationName()).toBe('Civernode');
    expect(getPublicRuntimeConfig().keycloakRealm).toBe('COCiber');
    expect(getConfiguredLocale()).toBe('pt-PT');
  });

  it('prefers the runtime organization name over the build-time environment', () => {
    vi.stubEnv('NEXT_PUBLIC_ORGANIZATION_NAME', 'Env Org');
    window.__CIVERNODE_CONFIG__ = { organizationName: '  Runtime Org  ', keycloakRealm: 'COCiber' };
    expect(getPublicOrganizationName()).toBe('Runtime Org');
  });

  it('uses NEXT_PUBLIC_ORGANIZATION_NAME when the runtime value is missing or blank', () => {
    vi.stubEnv('NEXT_PUBLIC_ORGANIZATION_NAME', 'Env Org');
    window.__CIVERNODE_CONFIG__ = { keycloakRealm: 'COCiber' };
    expect(getPublicOrganizationName()).toBe('Env Org');
    window.__CIVERNODE_CONFIG__ = { organizationName: '   ', keycloakRealm: 'COCiber' };
    expect(getPublicOrganizationName()).toBe('Env Org');
  });

  it('falls back to the product name, never the realm, when no organization name is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_ORGANIZATION_NAME', '  ');
    vi.stubEnv('NEXT_PUBLIC_KEYCLOAK_REALM', 'COCiber');
    window.__CIVERNODE_CONFIG__ = { organizationName: '', keycloakRealm: 'COCiber' };
    expect(getPublicOrganizationName()).toBe('Civernode');
    delete window.__CIVERNODE_CONFIG__;
    expect(getPublicOrganizationName()).toBe('Civernode');
  });

  it('uses deployment locale until a new organization is saved, then keeps persisted organization locale', () => {
    window.__CIVERNODE_CONFIG__ = { locale: 'en-US' };
    const freshInstall = { setupCompleted: false, organizationName: null, locale: 'pt-PT' };
    const savedOrganization = { setupCompleted: false, organizationName: 'SIMONEDA', locale: 'en-US' };
    const completedOrganization = { setupCompleted: true, organizationName: null, locale: 'pt-PT' };

    expect(hasSavedOrganizationLocale(freshInstall)).toBe(false);
    expect(resolveOrganizationLocale(freshInstall, getConfiguredLocale())).toBe('en-US');
    expect(hasSavedOrganizationLocale(savedOrganization)).toBe(true);
    expect(resolveOrganizationLocale(savedOrganization, 'pt-PT')).toBe('en-US');
    expect(hasSavedOrganizationLocale(completedOrganization)).toBe(true);
    expect(resolveOrganizationLocale(completedOrganization, 'en-US')).toBe('pt-PT');
  });
});
