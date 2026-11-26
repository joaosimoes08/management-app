import { describe, expect, it } from 'vitest';
import { translateLegacyText } from './legacy-messages';
import { loadLocaleBundle, translateWithBundle } from './locales/loader';

// Texts the old screens still emit through the legacy layer. Their rules were restored after the
// review of #216; each one must come out in English and never stay in Portuguese in a new language.
const cases: Array<[string, string]> = [
  ['3 selecionadas', '3 selected'],
  ['3 de 3 devices visíveis', '3 of 3 devices visible'],
  ['A mostrar 3 de 3 devices.', 'Showing 3 of 3 devices.'],
  ['3 de 3 registadas.', '3 of 3 recorded.'],
  ['Divergências pendentes em 3 devices', 'Pending drifts on 3 devices'],
  ['Credencial READ eliminada.', 'READ credential deleted.'],
];

const english = (text: string) => translateLegacyText('en-US', text);

describe('restored legacy rules', () => {
  it.each(cases)('translates "%s" to English', (input, expected) => {
    expect(english(input)).toBe(expected);
  });

  it.each(cases)('translates "%s" in es-ES, fr-FR, de-DE and it-IT', async (input, inEnglish) => {
    for (const locale of ['es-ES', 'fr-FR', 'de-DE', 'it-IT'] as const) {
      const result = translateWithBundle(await loadLocaleBundle(locale), input, english);
      // Spanish happens to spell this toast exactly as Portuguese does.
      if (!(locale === 'es-ES' && input === 'Credencial READ eliminada.')) expect(result, locale).not.toBe(input);
      expect(result, locale).not.toBe(inEnglish);
      expect(result, locale).toMatch(/3|READ/);
    }
  });
});
