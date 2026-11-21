import { describe, expect, it } from 'vitest';
import { countLabel } from './operations-panel';

describe('countLabel', () => {
  it('uses the singular only for exactly one item', () => {
    expect(countLabel(1, 'finding desatualizado', 'findings desatualizados')).toBe('1 finding desatualizado');
    expect(countLabel(0, 'finding desatualizado', 'findings desatualizados')).toBe('0 findings desatualizados');
    expect(countLabel(7, 'dispositivo sem problemas', 'dispositivos sem problemas')).toBe('7 dispositivos sem problemas');
  });
});
