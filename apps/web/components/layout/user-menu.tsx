'use client';

import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeClose } from '@/components/ui/use-escape-close';
import { useUiText } from '@/components/ui/use-ui-text';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

type Rect = { top: number; left: number; bottom: number; width: number; height: number };

/**
 * Places the menu above the anchor (below for the compact top-bar variant), flips when there is no
 * room, and clamps it inside the viewport. Exported for tests.
 */
export function placeUserDropdown(anchor: Rect, menu: { width: number; height: number }, viewport: { width: number; height: number }, prefer: 'top' | 'bottom') {
  const roomAbove = anchor.top - ANCHOR_GAP - VIEWPORT_MARGIN;
  const roomBelow = viewport.height - anchor.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
  const fitsAbove = menu.height <= roomAbove;
  const fitsBelow = menu.height <= roomBelow;
  const above = prefer === 'top' ? fitsAbove || (!fitsBelow && roomAbove >= roomBelow) : !(fitsBelow || roomBelow >= roomAbove);
  const rawTop = above ? anchor.top - ANCHOR_GAP - menu.height : anchor.bottom + ANCHOR_GAP;
  const rawLeft = prefer === 'top' ? anchor.left : anchor.left + anchor.width - menu.width;
  const clamp = (value: number, size: number, limit: number) => Math.max(VIEWPORT_MARGIN, Math.min(value, limit - size - VIEWPORT_MARGIN));
  return { top: clamp(rawTop, menu.height, viewport.height), left: clamp(rawLeft, menu.width, viewport.width), placement: above ? 'top' as const : 'bottom' as const };
}

/** User dropdown with profile, settings, help and logout actions. */
export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { user, profile, logout, hasRole } = useAuth();
  const { t } = useI18n();
  const ui = useUiText();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; placement: 'top' | 'bottom' } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const displayName = profile?.firstName || user?.username || ui('shell.userMenu.user');
  const roleLabel = user?.roles.includes('ADMIN') ? ui('shell.userMenu.admin') : user?.roles[0] ?? ui('shell.userMenu.user');

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setPosition(null);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useEscapeClose(close, open);

  const reposition = useCallback(() => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    const anchor = button.getBoundingClientRect();
    const next = placeUserDropdown(anchor, { width: menu.offsetWidth, height: menu.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, compact ? 'bottom' : 'top');
    setPosition((current) => (current && current.top === next.top && current.left === next.left && current.placement === next.placement ? current : next));
  }, [compact]);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    // The collapsed rail animates its width on hover, moving the button without resizing it, so
    // follow the anchor every frame while open; state only changes when the position does.
    let frame = 0;
    const track = () => { reposition(); frame = window.requestAnimationFrame(track); };
    frame = window.requestAnimationFrame(track);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.cancelAnimationFrame(frame);
    };
  }, [open, reposition, close]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number) => { event.preventDefault(); items[(next + items.length) % items.length].focus(); };
    if (event.key === 'ArrowDown') focusAt(index + 1);
    else if (event.key === 'ArrowUp') focusAt(index - 1);
    else if (event.key === 'Home') focusAt(0);
    else if (event.key === 'End') focusAt(items.length - 1);
    else if (event.key === 'Tab') close(false);
  };

  const go = (path: string) => { close(false); router.push(path); };
  // Until measured, keep it transparent rather than hidden so the first item can take focus.
  const style: CSSProperties = position ? { top: position.top, left: position.left } : { top: 0, left: 0, opacity: 0 };

  const menu = open ? <div ref={menuRef} className="user-dropdown user-dropdown-floating" role="menu" aria-label={displayName} data-placement={position?.placement} style={style} onKeyDown={onMenuKeyDown}>
    <div className="user-dropdown-head"><strong>{displayName}</strong><small>{user?.username}</small></div>
    <button type="button" role="menuitem" onClick={() => go('/perfil')}>{t('profile.menu')}</button>
    {(hasRole('ADMIN') || hasRole('AUDITOR')) && <button type="button" role="menuitem" onClick={() => go('/definicoes')}>{t('nav.settings')}</button>}
    <button type="button" role="menuitem" onClick={() => go('/ajuda')}>{t('nav.help')}</button>
    <button type="button" role="menuitem" className="danger" onClick={() => { close(false); void logout(); }}>{ui('shell.userMenu.logout')}</button>
  </div> : null;

  return <div ref={rootRef} className={`user-menu ${compact ? 'compact' : ''}`}>
    <button ref={buttonRef} type="button" className={compact ? 'top-user profile-button' : 'profile-mini profile-button'} onClick={() => (open ? close(false) : setOpen(true))} onKeyDown={(event) => { if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !open) { event.preventDefault(); setOpen(true); } }} aria-expanded={open} aria-haspopup="menu"><div className="profile-avatar">{displayName.charAt(0).toUpperCase()}</div><div className="user-menu-label"><strong>{displayName}</strong><span>{roleLabel}</span></div><ChevronDown size={compact ? 14 : 15} /></button>
    {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : null}
  </div>;
}
