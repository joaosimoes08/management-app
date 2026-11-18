import { describe, expect, it } from 'vitest';
import { nextSingleUserSelection } from './single-user-selection';

describe('Settings single-user selection', () => {
  it('replaces the previous selection when another user is checked', () => {
    expect(nextSingleUserSelection('user-a', 'user-b', true)).toBe('user-b');
  });

  it('clears the selection when its checkbox is unchecked', () => {
    expect(nextSingleUserSelection('user-a', 'user-a', false)).toBe('');
  });

  it('does not clear a different current selection on an unchecked event', () => {
    expect(nextSingleUserSelection('user-a', 'user-b', false)).toBe('user-a');
  });
});
