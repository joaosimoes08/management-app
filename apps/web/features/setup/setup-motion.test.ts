import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animateHeightChanges, CARD_HEIGHT_MS, ringTransition, stepIndicatorTransition, stepPanelVariants } from './setup-motion';

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

describe('animateHeightChanges', () => {
  type Callback = (entries: Array<{ borderBoxSize: Array<{ inlineSize: number; blockSize: number }> }>) => void;
  let callback: Callback;
  const resize = (width: number, height: number) => callback([{ borderBoxSize: [{ inlineSize: width, blockSize: height }] }]);
  const setup = (disabled = false) => {
    const element = document.createElement('section');
    const animation = { addEventListener: vi.fn(), cancel: vi.fn() };
    const animate = vi.fn(() => animation);
    Object.assign(element, { animate });
    const stop = animateHeightChanges(element, () => disabled);
    return { animate, animation, stop, element };
  };

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { constructor(cb: Callback) { callback = cb; } observe() {} disconnect() {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('animates only the height from the previous to the new size, with the step easing', () => {
    const { animate } = setup();
    resize(560, 540);
    expect(animate).not.toHaveBeenCalled();
    resize(560, 682);
    expect(animate).toHaveBeenCalledWith([{ height: '540px' }, { height: '682px' }], { duration: CARD_HEIGHT_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    expect(CARD_HEIGHT_MS).toBe(240);
  });

  it('ignores its own intermediate frames and resumes after the animation ends', () => {
    const { animate, animation, element } = setup();
    resize(560, 540);
    resize(560, 682);
    expect(element.style.height).toBe('540px');
    resize(560, 600);
    expect(animate).toHaveBeenCalledTimes(1);
    const finish = animation.addEventListener.mock.calls.find(([name]) => name === 'finish')![1] as () => void;
    finish();
    expect(element.style.height).toBe('');
    resize(560, 682);
    expect(animate).toHaveBeenCalledTimes(1);
    resize(560, 540);
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it('changes height instantly under reduced motion and on width changes', () => {
    const reduced = setup(true);
    resize(560, 540);
    resize(560, 682);
    expect(reduced.animate).not.toHaveBeenCalled();
    const resized = setup();
    resize(560, 540);
    resize(700, 620);
    expect(resized.animate).not.toHaveBeenCalled();
  });
});
