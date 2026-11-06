import { describe, expect, it } from 'vitest';
import { translateLegacyText } from './legacy-messages';

describe('legacy infrastructure messages', () => {
  it('translates the selected equipment update fallback', () => {
    expect(translateLegacyText('en-US', 'Não foi possível atualizar os equipamentos selecionados.'))
      .toBe('Could not update the selected equipment.');
  });

  it('translates bulk update outcomes while preserving counts', () => {
    expect(translateLegacyText('en-US', '3 atualizado(s) com sucesso.')).toBe('3 updated successfully.');
    expect(translateLegacyText('en-US', '2 atualizado(s); 1 falhou/falharam: Router: access denied'))
      .toBe('2 updated; 1 failed: Router: access denied');
  });
});
