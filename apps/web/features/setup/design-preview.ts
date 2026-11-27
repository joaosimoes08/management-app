/**
 * Dev-only design preview for first-run screens (e.g. /setup?preview=1&step=2).
 *
 * Lets an admin look at a screen that would normally redirect away (because the
 * flow is already complete) without saving anything. It is ignored in production
 * builds and for users without the ADMIN role.
 */
export type DesignPreviewOptions = { isAdmin: boolean; env?: string };

export function isDesignPreview(search: string | URLSearchParams | null | undefined, { isAdmin, env = process.env.NODE_ENV }: DesignPreviewOptions): boolean {
  if (env === 'production' || !isAdmin || !search) return false;
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return params.get('preview') === '1';
}

/** The `step` query value clamped to 0..lastStep; 0 when missing or invalid. */
export function designPreviewStep(search: string | URLSearchParams | null | undefined, lastStep: number): number {
  if (!search) return 0;
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const value = Number.parseInt(params.get('step') ?? '', 10);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), lastStep) : 0;
}

/** The current URL's query string on the client; empty during server rendering. */
export function currentSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}
