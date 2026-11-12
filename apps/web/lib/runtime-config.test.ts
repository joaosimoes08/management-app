import { afterEach, describe, expect, it } from 'vitest';
import { getConfiguredLocale, getPublicOrganizationName, getPublicRuntimeConfig, hasSavedOrganizationLocale, resolveOrganizationLocale } from './runtime-config';

describe('public runtime branding configuration', () => {
  afterEach(() => { delete window.__COCIBER_CONFIG__; });

  it('keeps the direct API port for local development', () => {
    expect(getPublicRuntimeConfig().apiUrl).toBe('http://localhost:3001');
  });

  it('uses a same-origin API for production hosts when no API URL is configured', () => {
    const originalLocation = window.location;
    try {
      Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, hostname: 'management.example.com' } });
      window.__COCIBER_CONFIG__ = {};

      expect(getPublicRuntimeConfig().apiUrl).toBe('');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    }
  });

  it('honors an explicitly configured API URL', () => {
    window.__COCIBER_CONFIG__ = { apiUrl: 'https://api.example.com' };
    expect(getPublicRuntimeConfig().apiUrl).toBe('https://api.example.com');
  });

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

  it('uses deployment locale until a new organization is saved, then keeps persisted organization locale', () => {
    window.__COCIBER_CONFIG__ = { locale: 'en-US' };
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
