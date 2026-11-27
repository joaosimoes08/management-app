import { describe, expect, it } from 'vitest';
import { designPreviewStep, isDesignPreview } from './design-preview';

describe('isDesignPreview', () => {
  it('is on for an admin with ?preview=1 outside production', () => {
    expect(isDesignPreview('?preview=1', { isAdmin: true, env: 'development' })).toBe(true);
    expect(isDesignPreview(new URLSearchParams('preview=1&step=2'), { isAdmin: true, env: 'test' })).toBe(true);
  });

  it('is ignored in production', () => {
    expect(isDesignPreview('?preview=1', { isAdmin: true, env: 'production' })).toBe(false);
  });

  it('is ignored for non-admins', () => {
    expect(isDesignPreview('?preview=1', { isAdmin: false, env: 'development' })).toBe(false);
  });

  it('needs preview=1 exactly', () => {
    expect(isDesignPreview('', { isAdmin: true, env: 'development' })).toBe(false);
    expect(isDesignPreview('?preview=true', { isAdmin: true, env: 'development' })).toBe(false);
  });
});

describe('designPreviewStep', () => {
  it('clamps the step and defaults to 0', () => {
    expect(designPreviewStep('?step=2', 3)).toBe(2);
    expect(designPreviewStep('?step=9', 3)).toBe(3);
    expect(designPreviewStep('?step=-1', 3)).toBe(0);
    expect(designPreviewStep('?step=x', 3)).toBe(0);
    expect(designPreviewStep('', 3)).toBe(0);
  });
});
