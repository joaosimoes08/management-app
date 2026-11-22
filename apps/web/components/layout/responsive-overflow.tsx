'use client';

import { Children, cloneElement, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

/** Prioritize the active entry, then retain earlier entries until the menu reserve is needed. */
export function visibleOverflowIndexes(widths: number[], activeIndex: number, availableWidth: number, menuWidth = 36, itemGap = 0, navPadding = 0, menuGap = 0): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * itemGap + navPadding;
  if (total <= availableWidth) return widths.map((_, index) => index);
  const keep = new Set<number>();
  keep.add(activeIndex);
  let used = menuWidth + menuGap + navPadding + (widths[activeIndex] ?? 0);
  const order = widths.map((_, index) => index).filter((index) => index !== activeIndex);
  for (const index of order) {
    if (used + itemGap + widths[index] <= availableWidth) {
      used += itemGap + widths[index];
      keep.add(index);
    }
  }
  return [...keep].sort((a, b) => a - b);
}

/** Keeps equal-width tabs only when every visible label fits its shared slot. */
export function visibleEqualSlotIndexes(widths: number[], activeIndex: number, availableWidth: number, menuWidth = 36, itemGap = 0, navPadding = 0, menuGap = 0): number[] {
  if (!widths.length) return [];
  const slotWidth = (count: number, reserveMenu: boolean) => {
    const menuReserve = reserveMenu ? menuWidth + menuGap : 0;
    return (availableWidth - menuReserve - navPadding - Math.max(0, count - 1) * itemGap) / count;
  };
  if (Math.max(...widths) <= slotWidth(widths.length, false)) return widths.map((_, index) => index);

  const keep = [Math.min(Math.max(activeIndex, 0), widths.length - 1)];
  const order = widths.map((_, index) => index).filter((index) => index !== keep[0]);
  for (const index of order) {
    const candidate = [...keep, index];
    const widestLabel = Math.max(...candidate.map((item) => widths[item]));
    if (widestLabel <= slotWidth(candidate.length, candidate.length < widths.length)) keep.push(index);
  }
  return keep.sort((a, b) => a - b);
}

export function visibleActionIndexes(widths: number[], isPrimary: boolean[], availableWidth: number, menuWidth = 50): number[] {
  if (widths.reduce((sum, width) => sum + width, 0) <= availableWidth) return widths.map((_, index) => index);
  const keep = new Set<number>();
  let used = menuWidth + widths.reduce((sum, width, index) => sum + (isPrimary[index] ? width : 0), 0);
  isPrimary.forEach((primary, index) => { if (primary) keep.add(index); });
  widths.forEach((width, index) => {
    if (!isPrimary[index] && used + width <= availableWidth) { used += width; keep.add(index); }
  });
  return [...keep].sort((a, b) => a - b);
}

function useMeasuredWidths(container: React.RefObject<HTMLElement | null>, count: number) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ available: Number.POSITIVE_INFINITY, widths: [] as number[], itemGap: 0, navPadding: 0 });
  const measure = useCallback(() => {
    if (!container.current || !measureRef.current) return;
    const available = container.current.clientWidth;
    const measuredItems = Array.from(measureRef.current.children).flatMap((item) => item instanceof HTMLElement && item.tagName === 'NAV' ? Array.from(item.children) : [item]);
    const widths = measuredItems.slice(0, count).map((item) => (item as HTMLElement).getBoundingClientRect().width);
    const measuredNav = Array.from(measureRef.current.children).find((item) => item instanceof HTMLElement && item.tagName === 'NAV') as HTMLElement | undefined;
    const style = measuredNav ? window.getComputedStyle(measuredNav) : undefined;
    const itemGap = Number.parseFloat(style?.columnGap ?? '0') || 0;
    const navPadding = (Number.parseFloat(style?.paddingLeft ?? '0') || 0) + (Number.parseFloat(style?.paddingRight ?? '0') || 0);
    setLayout((previous) => previous.available === available && previous.itemGap === itemGap && previous.navPadding === navPadding && previous.widths.every((width, index) => width === widths[index]) && previous.widths.length === widths.length ? previous : { available, widths, itemGap, navPadding });
  }, [container, count]);
  useLayoutEffect(() => { measure(); }, [measure]);
  useEffect(() => {
    if (!container.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(container.current);
    if (measureRef.current) observer.observe(measureRef.current);
    return () => observer.disconnect();
  }, [measure, container]);
  return { ...layout, measureRef };
}

export function ResponsiveOverflowMenu({ children, label, onSelect }: { children: ReactNode[]; label: string; onSelect: () => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  const focusableItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),summary,input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? []);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    window.addEventListener('keydown', escape);
    requestAnimationFrame(() => focusableItems()[0]?.focus());
    return () => window.removeEventListener('keydown', escape);
  }, [open]);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.matches('input,select,textarea,[contenteditable="true"]')) return;
    const items = focusableItems();
    const currentIndex = items.indexOf(target);
    if (!items.length || currentIndex < 0) return;
    let nextIndex: number | undefined;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
    if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex !== undefined) { event.preventDefault(); items[nextIndex]?.focus(); }
  };
  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('input,select,textarea,[contenteditable="true"]')) return;
    if (!target.closest('a[href],button,[role="button"]')) return;
    onSelect();
    close();
  };
  return <div className="responsive-overflow-menu">
    <button ref={triggerRef} type="button" className="responsive-overflow-trigger" aria-label={label} aria-controls={menuId} aria-expanded={open} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={17} /></button>
    {open && <div id={menuId} ref={menuRef} className="responsive-overflow-popover" role="group" aria-label={label} onKeyDown={handleKeyDown} onClick={handleClick}>
      {children.map((child, index) => isValidElement(child) ? cloneElement(child, { key: child.key ?? index }) : <div key={index}>{child}</div>)}
    </div>}
  </div>;
}

/** Keeps an active tab visible and moves lower-priority tabs into a keyboard-operable menu. */
export function ResponsiveTabNavigation({ navigation }: { navigation: ReactElement<{ children?: ReactNode; className?: string }> }) {
  const items = Children.toArray(navigation.props.children);
  const activeIndex = Math.max(0, items.findIndex((item) => isValidElement(item) && (item.props as { className?: string; 'aria-current'?: string })['aria-current'] === 'page' || isValidElement(item) && String((item.props as { className?: string }).className ?? '').split(' ').includes('active')));
  const containerRef = useRef<HTMLDivElement>(null);
  const { available, widths, itemGap, navPadding, measureRef } = useMeasuredWidths(containerRef, items.length);
  const isInfrastructureMenu = String(navigation.props.className ?? '').split(' ').includes('infra-menu');
  const visible = widths.length === items.length
    ? isInfrastructureMenu
      ? visibleEqualSlotIndexes(widths, activeIndex, available, 36, itemGap, navPadding, 4)
      : visibleOverflowIndexes(widths, activeIndex, available, 36, itemGap, navPadding, 4)
    : items.map((_, index) => index);
  const visibleSet = new Set(visible);
  const hiddenItems = items.filter((_, index) => !visibleSet.has(index));
  const renderedNavigation = cloneElement(navigation, { children: items.filter((_, index) => visibleSet.has(index)) });
  return <div className="responsive-tab-navigation" ref={containerRef}>
    {renderedNavigation}
    {!!hiddenItems.length && <ResponsiveOverflowMenu label="Mais secções" onSelect={() => {}}>{hiddenItems}</ResponsiveOverflowMenu>}
    <div className="responsive-overflow-measure" ref={measureRef} aria-hidden="true">{cloneElement(navigation, { children: items })}</div>
  </div>;
}

/**
 * Flattens nested fragments/divs into one list of actions. Children.toArray keys
 * restart at `.0` inside every nested fragment, so each element is re-keyed with
 * its full path (`.1/.0`) to keep keys unique across levels.
 */
export function flattenToolbarChildren(children: ReactNode, prefix = ''): ReactNode[] {
  return Children.toArray(children).filter(Boolean).flatMap((node, index) => {
    if (!isValidElement(node)) return [node];
    const key = `${prefix}${node.key ?? `.${index}`}`;
    if (node.type === Fragment || node.type === 'div') return flattenToolbarChildren((node.props as { children?: ReactNode }).children, `${key}/`);
    return [cloneElement(node, { key })];
  });
}

/** Moves secondary direct toolbar actions into a menu when they do not fit beside primary actions. */
export function ResponsiveToolbarActions({ children }: { children: ReactNode }) {
  const items = flattenToolbarChildren(children);
  const containerRef = useRef<HTMLDivElement>(null);
  const { available, widths, measureRef } = useMeasuredWidths(containerRef, items.length);
  const primary = (item: ReactNode) => isValidElement(item) && String((item.props as { className?: string }).className ?? '').split(' ').some((className) => className === 'primary-button' || className === 'toolbar-action-primary');
  const isPrimary = items.map(primary);
  const visibleIndexes = new Set(widths.length === items.length ? visibleActionIndexes(widths, isPrimary, available) : items.map((_, index) => index));
  const hidden = items.filter((_, index) => !visibleIndexes.has(index));
  if (!items.length) return null;
  // Natural width of every action side by side (6px gap), so a toolbar can reserve room for them before shrinking its other contents.
  const naturalWidth = widths.length === items.length ? Math.ceil(widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * 6) : undefined;
  return <div className="responsive-toolbar-actions" ref={containerRef} style={naturalWidth ? { '--toolbar-actions-width': `${naturalWidth}px` } as React.CSSProperties : undefined}>
    <div className="responsive-toolbar-actions-visible">{items.filter((_, index) => visibleIndexes.has(index))}</div>
    {!!hidden.length && <ResponsiveOverflowMenu label="Mais ações" onSelect={() => {}}>{hidden}</ResponsiveOverflowMenu>}
    <div className="responsive-overflow-measure" ref={measureRef} aria-hidden="true">{items.map((item, index) => <span className="responsive-overflow-measure-item" key={isValidElement(item) ? item.key ?? index : index}>{item}</span>)}</div>
  </div>;
}
