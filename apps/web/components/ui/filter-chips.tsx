'use client';

import type { ReactNode } from 'react';
import { formatNumber } from '@/lib/format/date';
import { nextChipValue, type ChipOption } from '@/lib/filter-chips';
import { useUiText } from './use-ui-text';

type FilterChipsProps = {
  /** Visible name of the dimension ("Estado"); also names the button group. */
  label: string;
  /** Selected value; '' selects the "all" chip. */
  value: string;
  options: readonly ChipOption[];
  onChange: (value: string) => void;
  /** Count shown on the "all" chip; omitted while unknown. */
  total?: number;
  /** Text of the "all" chip; defaults to "Todos". */
  allLabel?: string;
};

const countText = (count: number | undefined) => (count === undefined ? '…' : formatNumber(count));

/**
 * Segmented chip toggles for one filter dimension, each with its row count.
 * Clicking the selected chip goes back to "all". Chips with no rows are
 * disabled unless selected, so a filter from a link can always be cleared.
 */
export function FilterChips({ label, value, options, onChange, total, allLabel }: FilterChipsProps) {
  const t = useUiText();
  const all = allLabel ?? t('filterChips.all');
  return <div className="filter-chips" role="group" aria-label={label}>
    <span className="filter-chips-label" aria-hidden="true">{label}</span>
    <button type="button" className={`filter-chip${value === '' ? ' active' : ''}`} aria-pressed={value === ''} onClick={() => onChange('')}>
      <span>{all}</span>{total !== undefined && <span className="filter-chip-count">{countText(total)}</span>}
    </button>
    {options.map((option) => {
      const active = option.value === value;
      return <button key={option.value} type="button" className={`filter-chip${active ? ' active' : ''}`} aria-pressed={active} disabled={!active && option.count === 0} onClick={() => onChange(nextChipValue(value, option.value))}>
        <span>{option.label}</span><span className="filter-chip-count">{countText(option.count)}</span>
      </button>;
    })}
  </div>;
}

/**
 * One line of FilterChips groups. It never wraps: on narrow screens the row
 * scrolls sideways inside its own box.
 */
export function FilterChipBar({ label, children }: { label?: string; children: ReactNode }) {
  const t = useUiText();
  return <div className="filter-chip-bar" role="group" aria-label={label ?? t('filterChips.bar')}>{children}</div>;
}
