'use client';

import { useEscapeClose } from '@/components/ui/use-escape-close';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Plug, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { formatBudget, formatWatts, PDU_IMAGE, powerLevel, type PduView } from '../../power';
import { usePowerDefaults } from '../../use-power-defaults';
import { box, placeHoverCard, racksBox, setOpenPduCardBox, type HoverCardPlacement } from './rack-device-hover-card';

/** Below this drawn width the strip collapses to a thin bar with only the badge. */
export const PDU_COMPACT_WIDTH = 26;
/** Thin-bar width in compact mode. */
export const PDU_THIN_WIDTH = 10;
/** Delay before a hover-opened card closes, so the pointer can travel from the strip into the card. */
const HOVER_CLOSE_MS = 160;

export interface RackPduStripProps {
  view: PduView;
  /** Side of the racks the strip is on: supplier left, UPS right. Its card prefers the same side. */
  side: HoverCardPlacement['side'];
  /** Drawn size in px (same height as the rack frame). */
  width: number;
  height: number;
  /** ADMIN / SYSTEMS_OPERATOR: shows Desligar. Everyone else gets a read-only card. */
  canDisconnect: boolean;
  onDisconnect?: (pduId: string, deviceId: string) => Promise<void>;
}

type OpenMode = 'hover' | 'focus' | 'pinned';

/**
 * Vertical PDU drawn beside the rack, with a used/estimated-watts badge and one marker per outlet (outlet 1 at the top).
 * Hover, focus or tap opens its card; Esc closes it and returns focus to the strip.
 */
export function RackPduStrip({ view, side, width, height, canDisconnect, onDisconnect }: RackPduStripProps) {
  const { t, locale } = useI18n();
  const cardId = useId();
  const stripRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<OpenMode | null>(null);
  const closeTimer = useRef(0);
  const compact = width < PDU_COMPACT_WIDTH;
  const source = t(`rack.pdu.source.${view.pdu.source}`, view.pdu.source === 'UPS' ? 'UPS' : 'Rede');
  const watts = formatWatts(view.watts, locale);
  const badge = t('rack.pdu.badge', '{used}/{total} em uso · {watts} est.', { used: view.used, total: view.total, watts });

  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const close = useCallback((returnFocus = false) => {
    window.clearTimeout(closeTimer.current);
    setOpen(null);
    if (returnFocus) stripRef.current?.focus();
  }, []);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('pduId') !== view.pdu.id) return;
    stripRef.current?.scrollIntoView?.({ block: 'nearest' });
    setOpen('pinned');
  }, [view.pdu.id]);

  const hoverIn = () => { cancelClose(); setOpen((current) => current ?? 'hover'); };
  const hoverOut = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen((current) => (current === 'hover' ? null : current)), HOVER_CLOSE_MS);
  };
  const inside = (node: EventTarget | null) => node instanceof Node && (stripRef.current?.contains(node) || cardRef.current?.contains(node));

  // A pinned card closes on a click or tap anywhere else.
  useEffect(() => {
    if (open !== 'pinned') return;
    const outside = (event: PointerEvent) => { if (!inside(event.target)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, close]);

  const usedOutlets = new Set(view.connections.flatMap((connection) => connection.outlets.map((outlet) => outlet.outletIndex)));
  const style: CSSProperties = { width: `${compact ? PDU_THIN_WIDTH : width}px`, height: `${height}px` };
  const fill = view.total > 0 ? Math.min(100, (view.used / view.total) * 100) : 0;

  return <>
    <button
      ref={stripRef}
      type="button"
      className={`rack-pdu${compact ? ' rack-pdu-compact' : ''}`}
      data-source={view.pdu.source}
      data-side={side}
      data-level={view.level}
      style={style}
      aria-label={t('rack.pdu.open', '{name} ({source}): {used} de {total} tomadas em uso, {watts} estimado. Abrir detalhes', { name: view.name, source, used: view.used, total: view.total, watts })}
      aria-haspopup="dialog"
      aria-expanded={open !== null}
      aria-controls={open ? cardId : undefined}
      title={compact ? `${view.name} · ${badge}` : undefined}
      onMouseEnter={hoverIn}
      onMouseLeave={hoverOut}
      onFocus={(event) => {
        let visible = true;
        try { visible = event.currentTarget.matches(':focus-visible'); } catch { /* jsdom */ }
        if (visible) setOpen((current) => current ?? 'focus');
      }}
      onBlur={(event) => { if (!inside(event.relatedTarget)) setOpen((current) => (current === 'pinned' ? current : null)); }}
      onClick={() => setOpen((current) => (current === 'pinned' ? null : 'pinned'))}
      onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); close(true); } }}
    >
      {compact
        ? <span className="rack-pdu-thin" aria-hidden="true"><span className="rack-pdu-thin-fill" style={{ height: `${fill}%` }} /></span>
        : <>
          <span className="rack-pdu-art" style={{ backgroundImage: `url(${PDU_IMAGE})` }} aria-hidden="true" />
          <span className="rack-pdu-leds" aria-hidden="true">{Array.from({ length: view.total }, (_, index) => <i key={index} data-used={usedOutlets.has(index + 1) || undefined} />)}</span>
        </>}
      <span className={`rack-pdu-badge${compact ? ' rack-pdu-badge-compact' : ''}`} aria-hidden="true" data-level={view.level}>
        <b>{view.used}/{view.total}</b>
        {!compact && <small>{watts}</small>}
      </span>
    </button>
    {open && <RackPduCard
      ref={cardRef}
      id={cardId}
      anchor={stripRef}
      side={side}
      view={view}
      source={source}
      badge={badge}
      canDisconnect={canDisconnect}
      onDisconnect={onDisconnect}
      onPointerEnter={() => { cancelClose(); }}
      onPointerLeave={() => { if (open === 'hover') hoverOut(); }}
      onFocusInside={() => setOpen((current) => (current === 'hover' || current === 'focus' ? 'pinned' : current))}
      onBlurOutside={(next) => { if (!inside(next)) setOpen((current) => (current === 'pinned' ? current : null)); }}
      onClose={() => close(true)}
    />}
  </>;
}

interface RackPduCardProps {
  ref: React.RefObject<HTMLDivElement | null>;
  id: string;
  anchor: React.RefObject<HTMLButtonElement | null>;
  side: HoverCardPlacement['side'];
  view: PduView;
  source: string;
  badge: string;
  canDisconnect: boolean;
  onDisconnect?: (pduId: string, deviceId: string) => Promise<void>;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocusInside: () => void;
  onBlurOutside: (next: EventTarget | null) => void;
  onClose: () => void;
}

/** The PDU's card: totals, failover line and its connected devices with Desligar. Portalled with fixed coordinates. */
function RackPduCard({ ref, id, anchor, side, view, source, badge, canDisconnect, onDisconnect, onPointerEnter, onPointerLeave, onFocusInside, onBlurOutside, onClose }: RackPduCardProps) {
  const { t, locale } = useI18n();
  const warningRatio = usePowerDefaults()?.warningRatio;
  const level = (used: number, total: number) => powerLevel({ used, total, watts: 0, budget: null, warningRatio });
  const [placement, setPlacement] = useState<HoverCardPlacement | null>(null);
  const [confirming, setConfirming] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const update = useCallback(() => {
    const strip = anchor.current;
    const card = ref.current;
    if (!strip || !card || !strip.isConnected) return;
    const stage = strip.closest('.rack-stage-wrap') ?? strip.closest('.rack-stage') ?? strip;
    const badgeBox = box(strip.querySelector('.rack-pdu-badge') ?? strip);
    const next = placeHoverCard({
      device: badgeBox,
      rack: racksBox(strip).rack,
      prefer: side,
      stage: box(stage),
      card: { width: card.offsetWidth, height: card.offsetHeight },
      viewport: { width: document.documentElement.clientWidth || window.innerWidth, height: document.documentElement.clientHeight || window.innerHeight },
    });
    setPlacement((previous) => (previous && previous.top === next.top && previous.left === next.left && previous.side === next.side ? previous : next));
    setOpenPduCardBox(id, { top: next.top, left: next.left, right: next.left + card.offsetWidth, bottom: next.top + card.offsetHeight });
  }, [anchor, ref, side, id]);

  useLayoutEffect(() => { update(); });
  useEffect(() => () => setOpenPduCardBox(id, null), [id]);
  useEffect(() => {
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
  }, [update]);

  const disconnect = async (deviceId: string) => {
    if (!onDisconnect) return;
    setBusy(deviceId);
    setError('');
    try {
      await onDisconnect(view.pdu.id, deviceId);
      setConfirming('');
    } catch {
      setError(t('rack.pdu.disconnectFailed', 'Não foi possível desligar o equipamento.'));
    } finally {
      setBusy('');
    }
  };

  const budgetText = view.budget ? formatBudget(view.budget, locale) : t('rack.pdu.noBudget', 'sem limite definido');
  const loadLevel = powerLevel({ used: 0, total: 0, watts: view.watts, budget: view.budget, warningRatio });
  const percent = view.budget ? ` · ${Math.round((view.watts / view.budget) * 100)}%` : '';

  useEscapeClose(() => {
    if (confirming) setConfirming('');
    else onClose();
  });

  if (typeof document === 'undefined') return null;
  return createPortal(<div
    ref={ref}
    id={id}
    role="dialog"
    aria-modal="false"
    aria-label={`${view.name} · ${source}`}
    className="rack-pdu-card"
    data-side={placement?.side}
    data-level={view.level}
    data-source={view.pdu.source}
    style={{ top: placement?.top ?? 0, left: placement?.left ?? 0, visibility: placement ? 'visible' : 'hidden' }}
    onPointerEnter={onPointerEnter}
    onPointerLeave={onPointerLeave}
    onFocus={onFocusInside}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onBlurOutside(event.relatedTarget); }}
  >
    <header className="rack-pdu-card-head">
      <strong>{view.name}</strong>
      <button type="button" className="rack-pdu-card-close" aria-label={t('rack.pdu.close', 'Fechar')} onClick={onClose}><X size={13} aria-hidden="true" /></button>
    </header>
    <dl className="rack-pdu-card-totals">
      <div><dt>{t('rack.pdu.sourceLabel', 'Fonte')}:</dt><dd><span className="rack-pdu-card-source" data-source={view.pdu.source}>{source}</span></dd></div>
      <div><dt>{t('rack.pdu.outlets', 'Tomadas')}:</dt><dd data-level={level(view.used, view.total)}>{view.used}/{view.total}</dd></div>
      <div><dt>{t('rack.pdu.load', 'Consumo')}:</dt><dd data-level={loadLevel}>{formatWatts(view.watts, locale)} {t('rack.pdu.estimated', 'estimado')}</dd></div>
      <div><dt>{t('rack.pdu.budget', 'Limite')}:</dt><dd data-level={view.budget ? loadLevel : undefined}>{budgetText}{percent}</dd></div>
    </dl>
    {view.failoverWatts != null && <p className="rack-pdu-card-failover" data-level={powerLevel({ used: 0, total: 0, watts: view.failoverWatts, budget: view.budget, warningRatio })}>{t('rack.pdu.failover', 'Se a outra fonte falhar: {watts}', { watts: formatWatts(view.failoverWatts, locale) })}</p>}
    <span className="topology-sr-only">{badge}</span>
    <h3>{t('rack.pdu.devices', 'Equipamentos ligados')}{!canDisconnect && <small className="rack-pdu-card-readonly">{t('rack.pdu.readOnly', 'Só leitura')}</small>}</h3>
    {view.connections.length === 0
      ? <p className="rack-pdu-card-empty">{t('rack.pdu.empty', 'Nenhum equipamento ligado a esta PDU.')}</p>
      : <ul className="rack-pdu-card-list">
        {view.connections.map((connection) => {
          const count = connection.outlets.length;
          const plugs = t('rack.pdu.plugs', '{count} tomadas', { count });
          return <li key={connection.deviceId} data-device={connection.deviceId}>
            <div className="rack-pdu-card-row">
              <Plug size={12} aria-hidden="true" />
              <span className="rack-pdu-card-who">
                <span className="rack-pdu-card-device" title={connection.deviceName}>{connection.deviceName}</span>
                <span className="rack-pdu-card-meta">{plugs}{connection.dualFed ? ` · ${t('rack.pdu.dualFed', '2 fontes')}` : ''}</span>
              </span>
              <span className="rack-pdu-card-watts">{formatWatts(connection.watts, locale)}</span>
              {canDisconnect && onDisconnect && confirming !== connection.deviceId && <button type="button" className="rack-pdu-card-disconnect" aria-label={t('rack.pdu.disconnectLabel', 'Desligar {device} de {pdu}', { device: connection.deviceName, pdu: view.name })} onClick={() => { setError(''); setConfirming(connection.deviceId); }}>{t('rack.pdu.disconnect', 'Desligar')}</button>}
            </div>
            {confirming === connection.deviceId && <div className="rack-pdu-card-confirm" role="group" aria-label={t('rack.pdu.disconnectLabel', 'Desligar {device} de {pdu}', { device: connection.deviceName, pdu: view.name })}>
              <span>{t('rack.pdu.disconnectConfirm', 'Desligar {device} de {pdu}? Liberta {count} tomada(s).', { device: connection.deviceName, pdu: view.name, count })}</span>
              <div>
                <button type="button" className="secondary-button" disabled={busy === connection.deviceId} onClick={() => setConfirming('')}>{t('rack.pdu.cancel', 'Cancelar')}</button>
                <button type="button" className="secondary-button danger-button" autoFocus disabled={busy === connection.deviceId} onClick={() => void disconnect(connection.deviceId)}>{busy === connection.deviceId ? t('rack.pdu.disconnecting', 'A desligar…') : t('rack.pdu.disconnect', 'Desligar')}</button>
              </div>
            </div>}
          </li>;
        })}
      </ul>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <small className="rack-pdu-card-note">{t('power.estimateNote', 'Valores estimados')}</small>
  </div>, document.body);
}
