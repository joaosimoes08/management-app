import { describe, expect, it } from 'vitest';
import { translateMessage, type AppLocale } from '@/lib/i18n/i18n';
import { loadLocaleBundle } from '@/lib/i18n/locales/loader';
import { discoveryJobName } from './discovery-status';

const tFor = (locale: AppLocale) => (key: string, fallback?: string, params?: Record<string, string | number>) => translateMessage(locale, key, fallback, params);

// Review round 2, Browser Tester 2: what main 0715e74d showed for a run saved as "Discovery manual".
const shownOnMain: Array<[AppLocale, string]> = [
  ['pt-PT', 'Discovery manual'],
  ['en-US', 'Manual discovery'],
  ['es-ES', 'Descubrimiento manual'],
  ['fr-FR', 'Découverte manuelle'],
  ['de-DE', 'Manuelle Discovery'],
  ['it-IT', 'Rilevamento manuale'],
];

describe('discoveryJobName', () => {
  it.each(shownOnMain)('shows the Portuguese default run name in %s as main did', async (locale, shown) => {
    if (locale !== 'pt-PT' && locale !== 'en-US') await loadLocaleBundle(locale);
    expect(discoveryJobName(tFor(locale), 'Discovery manual')).toBe(shown);
  });

  it('keeps other run names as typed, including the scheduled-run names the API makes', () => {
    for (const name of ['Discovery agendado · 2026-11-28T10:00:00.000Z', 'Discovery manual · LIS', 'Varrimento DMZ', 'Manual discovery']) {
      expect(discoveryJobName(tFor('en-US'), name)).toBe(name);
    }
  });
});
