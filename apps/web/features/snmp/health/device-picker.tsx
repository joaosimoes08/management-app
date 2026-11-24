'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { useUiText } from '@/components/ui/use-ui-text';
import type { SnmpHealthSummaryItem } from './health-api';
import { SnmpHealthBadge } from './health-badge';

export interface DevicePickerOption { id: string; name: string; managementIp?: string | null; type?: string | null }

/** Options rendered at once; the search narrows larger lists. */
export const DEVICE_PICKER_LIMIT = 100;

const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Case- and accent-insensitive match on name, management IP and type; every word must match. */
export function filterDeviceOptions<T extends DevicePickerOption>(options: T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return options;
  return options.filter((option) => {
    const haystack = fold([option.name, option.managementIp ?? '', option.type ?? ''].join(' '));
    return words.every((word) => haystack.includes(word));
  });
}

export interface DevicePickerProps {
  options: DevicePickerOption[];
  value: string;
  onChange: (deviceId: string) => void;
  label?: string;
  disabled?: boolean;
  /** Optional health per device id: shows the SNMP health badge next to each option. */
  health?: ReadonlyMap<string, SnmpHealthSummaryItem>;
  className?: string;
}

/**
 * SNMP Phase 2 step 10: searchable device picker (ARIA 1.2 combobox with a listbox popup), reusable wherever an SNMP
 * screen picks a device. Typing filters by name, IP or type; ArrowUp/ArrowDown move, Enter picks, Escape closes
 * and restores the current device, and the result count is announced to screen readers.
 */
export function DevicePicker({ options, value, onChange, label, disabled = false, health, className = '' }: DevicePickerProps) {
  const t = useUiText();
  const id = useId();
  const inputId = `${id}-input`; const listId = `${id}-list`; const statusId = `${id}-status`;
  const selected = options.find((option) => option.id === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const filtered = useMemo(() => filterDeviceOptions(options, editing ? query : ''), [options, query, editing]);
  const shown = filtered.slice(0, DEVICE_PICKER_LIMIT);
  const optionText = (option: DevicePickerOption) => `${option.name} · ${option.managementIp || t('devicePicker.noIp')}`;

  const close = (restore = true) => { setOpen(false); setEditing(false); if (restore) setQuery(''); };
  const openList = () => {
    if (disabled) return;
    const index = shown.findIndex((option) => option.id === value);
    setActive(index >= 0 ? index : 0);
    setOpen(true);
  };
  const pick = (option: DevicePickerOption | undefined) => {
    if (!option) return;
    if (option.id !== value) onChange(option.id);
    close();
    inputRef.current?.focus();
  };

  useEffect(() => { if (active >= shown.length) setActive(Math.max(0, shown.length - 1)); }, [active, shown.length]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); if (!open) openList(); else setActive((index) => Math.min(index + 1, Math.max(shown.length - 1, 0))); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (!open) openList(); else setActive((index) => Math.max(index - 1, 0)); }
    else if (event.key === 'Home' && open) { event.preventDefault(); setActive(0); }
    else if (event.key === 'End' && open) { event.preventDefault(); setActive(Math.max(shown.length - 1, 0)); }
    else if (event.key === 'Enter') { if (open) { event.preventDefault(); pick(shown[active]); } }
    else if (event.key === 'Escape') { if (open || editing) { event.preventDefault(); event.stopPropagation(); close(); } }
    else if (event.key === 'Tab') { if (open) close(); }
  };

  const activeId = open && shown[active] ? `${id}-option-${shown[active].id}` : undefined;
  const status = !open ? '' : !options.length ? t('devicePicker.empty') : !filtered.length ? t('devicePicker.noResults') : t('devicePicker.results', undefined, { count: filtered.length });

  return <div className={`device-picker ${className}`.trim()} ref={rootRef}>
    <label htmlFor={inputId}>{label ?? t('devicePicker.label')}</label>
    <div className="device-picker-field">
      <input ref={inputRef} id={inputId} className="context-toolbar-selector device-picker-input" type="text" role="combobox" autoComplete="off" spellCheck={false}
        aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={activeId} aria-describedby={statusId}
        placeholder={t('devicePicker.placeholder')} disabled={disabled}
        value={editing ? query : selected ? optionText(selected) : ''}
        onFocus={(event) => event.currentTarget.select()}
        onClick={() => { if (!open) openList(); }}
        onChange={(event) => { setEditing(true); setQuery(event.target.value); setActive(0); setOpen(true); }}
        onKeyDown={onKeyDown} />
      <button type="button" className="device-picker-toggle" tabIndex={-1} aria-label={t('devicePicker.toggle')} aria-controls={listId} aria-expanded={open} disabled={disabled}
        onMouseDown={(event) => event.preventDefault()} onClick={() => { if (open) close(); else { openList(); inputRef.current?.focus(); } }}>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
    </div>
    <ul ref={listRef} id={listId} role="listbox" aria-label={label ?? t('devicePicker.label')} className="device-picker-list" hidden={!open}>
      {open && shown.map((option, index) => <li key={option.id} id={`${id}-option-${option.id}`} role="option" data-index={index} aria-selected={option.id === value}
        className={`${index === active ? 'is-active' : ''}${option.id === value ? ' is-selected' : ''}`.trim() || undefined}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => pick(option)}>
        <span className="device-picker-option-text"><strong>{option.name}</strong><small>{[option.managementIp || t('devicePicker.noIp'), option.type].filter(Boolean).join(' · ')}</small></span>
        {health && <SnmpHealthBadge item={health.get(option.id) ?? null} />}
      </li>)}
      {open && !shown.length && <li className="device-picker-empty" role="presentation">{options.length ? t('devicePicker.noResults') : t('devicePicker.empty')}</li>}
    </ul>
    <span id={statusId} className="topology-sr-only" role="status" aria-live="polite">{status}</span>
  </div>;
}
