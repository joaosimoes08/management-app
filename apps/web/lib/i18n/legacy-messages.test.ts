import { describe, expect, it, vi } from 'vitest';
import { observeLegacyDom, translateLegacyDom } from './i18n';
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

  it('keeps React-updated counts and attestation outcomes when translating a reused text node', () => {
    const count = document.createElement('span');
    count.textContent = '0';
    translateLegacyDom('en-US', count);
    const countText = count.firstChild as Text;
    countText.data = '1';
    translateLegacyDom('en-US', countText);
    expect(count.textContent).toBe('1');

    const outcome = document.createElement('span');
    outcome.textContent = 'Pendente';
    translateLegacyDom('en-US', outcome);
    const outcomeText = outcome.firstChild as Text;
    outcomeText.data = 'CONFIRMED';
    translateLegacyDom('en-US', outcomeText);
    expect(outcome.textContent).toBe('CONFIRMED');
  });

  it('does not restore stale text when the legacy DOM observer sees React updates', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<span>0</span><span>Pendente</span>';
    const [count, outcome] = [...root.querySelectorAll('span')];
    const disconnect = observeLegacyDom('en-US', root);
    try {
      count.firstChild!.textContent = '1';
      outcome.firstChild!.textContent = 'CONFIRMED';
      await vi.waitFor(() => {
        expect(count.textContent).toBe('1');
        expect(outcome.textContent).toBe('CONFIRMED');
      });
    } finally {
      disconnect();
    }
  });
});
