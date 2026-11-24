/**
 * The utility bar (.context-toolbar) stays on one line. When the page's controls do not fit beside the
 * title, AppShell switches the bar to compact mode and moves them into the "Controlos" panel.
 * These helpers decide whether the current one-line layout fits.
 */

/** Tallest a single-line part of the bar may be (controls are 34–40px high). Taller means it wrapped. */
export const CONTEXT_TOOLBAR_ROW_MAX = 48;

const PARTS = '.context-toolbar-title, .context-toolbar-navigation, .context-toolbar-actions';
const CONTROLS = 'button, select, input, textarea, a, summary, label, strong, [role="button"], [role="tab"]';

const shown = (element: Element) => element.getClientRects().length > 0;

/** Popovers, menus and hidden measuring clones are absolutely positioned; they never count as overflow. */
function floats(element: HTMLElement, stop: HTMLElement) {
  for (let node: HTMLElement | null = element; node && node !== stop; node = node.parentElement) {
    const position = window.getComputedStyle(node).position;
    if (position === 'absolute' || position === 'fixed') return true;
  }
  return false;
}

/** True when the bar has page controls (navigation or actions) that could move into the panel. */
export function contextToolbarHasControls(toolbar: HTMLElement) {
  return [...toolbar.querySelectorAll('.context-toolbar-navigation, .context-toolbar-actions')].some((part) => part.childElementCount > 0);
}

/** True when the bar, laid out on one line, wraps or pushes a control outside its part or the bar. */
export function contextToolbarOverflows(toolbar: HTMLElement) {
  const bar = toolbar.getBoundingClientRect();
  const style = window.getComputedStyle(toolbar);
  const left = bar.left + (Number.parseFloat(style.paddingLeft) || 0) - 1;
  const right = bar.right - (Number.parseFloat(style.paddingRight) || 0) + 1;
  const parts = [...toolbar.querySelectorAll<HTMLElement>(PARTS)].filter(shown);
  for (const part of parts) {
    const box = part.getBoundingClientRect();
    if (!box.width) continue;
    if (box.height > CONTEXT_TOOLBAR_ROW_MAX || box.left < left || box.right > right) return true;
    // A block inside the part (a page contribution, the "Mais ações" group at its minimum) spilling out of it.
    for (const child of part.children) {
      if (!(child instanceof HTMLElement) || !shown(child) || floats(child, part)) continue;
      const inner = child.getBoundingClientRect();
      if (inner.width && (inner.left < box.left - 1 || inner.right > box.right + 1)) return true;
    }
  }
  for (const control of toolbar.querySelectorAll<HTMLElement>(CONTROLS)) {
    // ResponsiveToolbarActions folds its own buttons into "Mais ações" and never shrinks below its primaries (CSS min-width).
    if (control.closest('.responsive-toolbar-actions-visible')) continue;
    const part = control.closest<HTMLElement>(PARTS);
    if (!part || !shown(control) || floats(control, part)) continue;
    const box = control.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const limit = part.getBoundingClientRect();
    if (box.left < Math.max(limit.left, left) - 1 || box.right > Math.min(limit.right, right) + 1) return true;
  }
  return false;
}
