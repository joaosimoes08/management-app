'use client';

import { useRef } from 'react';

export interface RackFaceOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface RackFaceToggleProps<T extends string> {
  label: string;
  value: T;
  options: RackFaceOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

/**
 * Segmented control for rack faces (Frente | Traseira | Ambas).
 * A radio group: Tab reaches the selected option, arrows, Home and End move and select.
 */
export function RackFaceToggle<T extends string>({ label, value, options, onChange, className = '' }: RackFaceToggleProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.filter((option) => !option.disabled);
  const select = (next: T) => {
    onChange(next);
    const index = options.findIndex((option) => option.value === next);
    buttons.current[index]?.focus();
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    const current = Math.max(0, enabled.findIndex((option) => option.value === value));
    let next: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % enabled.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + enabled.length) % enabled.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = enabled.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    select(enabled[next].value);
  };

  return <div className={`infra-menu rack-face-toggle ${className}`.trim()} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
    {options.map((option, index) => {
      const checked = option.value === value;
      return <button
        key={option.value}
        ref={(element) => { buttons.current[index] = element; }}
        type="button"
        role="radio"
        aria-checked={checked}
        tabIndex={checked ? 0 : -1}
        disabled={option.disabled}
        className={checked ? 'active' : ''}
        onClick={() => onChange(option.value)}
      >{option.label}</button>;
    })}
  </div>;
}
