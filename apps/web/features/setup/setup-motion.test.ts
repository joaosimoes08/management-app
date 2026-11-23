import { describe, expect, it } from 'vitest';
import { ringTransition, stepIndicatorTransition, stepPanelVariants } from './setup-motion';

type Target = { opacity?: number; x?: number; transition?: { duration?: number } };
const resolve = (variant: unknown, direction: 1 | -1) => (typeof variant === 'function' ? variant(direction) : variant) as Target;

describe('setup step motion', () => {
  it('slides in from the right on Next and from the left on Back', () => {
    const variants = stepPanelVariants(false);
    expect(resolve(variants.enter, 1).x).toBeGreaterThan(0);
    expect(resolve(variants.enter, -1).x).toBeLessThan(0);
    expect(resolve(variants.exit, 1).x).toBeLessThan(0);
    expect(resolve(variants.center, 1)).toMatchObject({ opacity: 1, x: 0 });
    expect(resolve(variants.center, 1).transition?.duration).toBeLessThanOrEqual(0.26);
  });

  it('with reduced motion there is no slide, only a very short fade, and the indicators jump', () => {
    const variants = stepPanelVariants(true);
    for (const direction of [1, -1] as const) {
      expect(resolve(variants.enter, direction).x ?? 0).toBe(0);
      expect(resolve(variants.exit, direction).x ?? 0).toBe(0);
    }
    expect(resolve(variants.center, 1).transition?.duration).toBeLessThanOrEqual(0.1);
    expect(stepIndicatorTransition(true)).toEqual({ duration: 0 });
    expect(ringTransition(true)).toEqual({ duration: 0 });
  });
});

