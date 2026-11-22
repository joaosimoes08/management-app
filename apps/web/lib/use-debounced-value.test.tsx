import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './use-debounced-value';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useDebouncedValue', () => {
  it('passes the value on only after typing pauses', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), { initialProps: { value: '' } });
    for (const value of ['1', '10', '10.', '10.0']) {
      rerender({ value });
      act(() => { vi.advanceTimersByTime(100); });
      expect(result.current).toBe('');
    }
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe('10.0');
  });
});
