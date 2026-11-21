'use client';

import { Eye } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { RackView } from '../../types';
import { rackViewChoices } from '../../utils';

export interface RackViewPickerProps {
  value: RackView;
  onChange: (view: RackView) => void;
  /** "Both" needs the wide layout; below it only Front and Rear are offered. */
  allowBoth: boolean;
  /** While a device is focused the picker drives only that device's face, so "Both" is never offered. */
  focused?: boolean;
}

/** Rack face picker for the utility bar, built like the building and room pickers. */
export function RackViewPicker({ value, onChange, allowBoth, focused = false }: RackViewPickerProps) {
  const { t } = useI18n();
  const views = rackViewChoices({ wide: allowBoth, focused });
  return <div className="rack-toolbar-picker rack-view-picker">
    <label title={t('rack.view')}>
      <Eye size={14} aria-hidden="true" />
      <select aria-label={t('rack.view')} value={value} onChange={(event) => onChange(event.target.value as RackView)}>
        {views.map((view) => <option key={view} value={view}>{t(`rack.view.${view}`)}</option>)}
      </select>
    </label>
  </div>;
}
