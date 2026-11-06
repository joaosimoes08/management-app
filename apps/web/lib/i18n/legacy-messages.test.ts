import { describe, expect, it } from 'vitest';
import { translateLegacyText } from './legacy-messages';

describe('legacy infrastructure messages', () => {
  it('translates the selected equipment update fallback', () => {
    expect(translateLegacyText('en-US', 'Não foi possível atualizar os equipamentos selecionados.'))
      .toBe('Could not update the selected equipment.');
  });

  it('translates bulk update outcomes while preserving persistence and audit status', () => {
    expect(translateLegacyText('en-US', '3 guardado(s).')).toBe('3 saved.');
    expect(translateLegacyText('en-US', '1 guardado(s). · Guardados, auditoria falhou: Router: A atualização foi guardada, mas não foi possível registar a auditoria.'))
      .toBe('1 saved. · Saved, but audit failed: Router: The update was saved, but its audit record could not be written.');
    expect(translateLegacyText('en-US', 'Não guardados: Router: Scope denied'))
      .toBe('Not saved: Router: Scope denied');
  });
});
