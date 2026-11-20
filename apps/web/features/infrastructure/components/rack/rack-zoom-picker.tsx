'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Magnet, RotateCcw } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/** Zoom factor at 0% (the rack fitted to the stage) and at 100%. */
export const RACK_ZOOM_MIN = 1;
export const RACK_ZOOM_MAX = 2.5;

/** Maps a 0–100% slider position onto the rack zoom factor. */
export function zoomFromPercent(percent: number): number {
  const clamped = Math.min(100, Math.max(0, percent));
  return +(RACK_ZOOM_MIN + (clamped / 100) * (RACK_ZOOM_MAX - RACK_ZOOM_MIN)).toFixed(3);
}

/** Maps a rack zoom factor back onto the 0–100% slider position. */
export function percentFromZoom(zoom: number): number {
  const clamped = Math.min(RACK_ZOOM_MAX, Math.max(RACK_ZOOM_MIN, zoom));
  return Math.round(((clamped - RACK_ZOOM_MIN) / (RACK_ZOOM_MAX - RACK_ZOOM_MIN)) * 100);
}

export interface RackZoomPickerProps {
  zoom: number;
  onZoom: (zoom: number) => void;
  /** Back to 0%: the rack fitted to the stage, scrolled to the top. */
  onFit: () => void;
}

/** Utility-bar trigger with the location-picker look that opens a 0–100% zoom slider below it. */
export function RackZoomPicker({ zoom, onZoom, onFit }: RackZoomPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const sliderId = useId();
  const percent = percentFromZoom(zoom);

  useEffect(() => {
    if (!open) return;
    sliderRef.current?.focus();
    const close = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Only close the panel: an open device focus behind it keeps listening for Escape.
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', escape, true); };
  }, [open]);

  return <div className="rack-toolbar-picker rack-zoom-picker" ref={rootRef}>
    <button
      ref={triggerRef}
      type="button"
      className="rack-toolbar-picker-trigger"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      aria-label={`${t('rack.zoom')}: ${percent}%`}
      onClick={() => setOpen((value) => !value)}
    >
      <Magnet size={14} aria-hidden="true" />
      <span>{t('rack.zoom')}</span>
      <output className="rack-zoom-value" aria-hidden="true">{percent}%</output>
      <ChevronDown className="rack-toolbar-picker-chevron" size={14} aria-hidden="true" />
    </button>
    {open && <div className="rack-zoom-panel" id={panelId} role="group" aria-label={t('rack.zoomPanel')}>
      <div className="rack-zoom-panel-head">
        <label htmlFor={sliderId}>{t('rack.zoomLevel')}</label>
        <output htmlFor={sliderId} className="rack-zoom-value" aria-live="polite">{percent}%</output>
      </div>
      <input
        id={sliderId}
        type="range"
        min={0}
        max={100}
        step={5}
        value={percent}
        aria-valuetext={`${percent}%`}
        ref={sliderRef}
        onChange={(event) => onZoom(zoomFromPercent(Number(event.target.value)))}
      />
      <div className="rack-zoom-scale" aria-hidden="true"><span>0%</span><span>100%</span></div>
      <button type="button" className="secondary-button rack-zoom-fit" onClick={onFit}><RotateCcw size={13} aria-hidden="true" />{t('rack.zoomFit')}</button>
    </div>}
  </div>;
}
