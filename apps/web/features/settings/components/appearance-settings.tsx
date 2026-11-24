'use client';

import { Check, Monitor, Moon, Sun } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAppearance } from '@/lib/theme/appearance';
import { themes, themeTokens, type ThemeModePreference } from '@/lib/theme/themes';

const modes: [ThemeModePreference, typeof Sun][] = [['light', Sun], ['dark', Moon], ['system', Monitor]];

/**
 * Theme picker. Both groups are native radio inputs, so Tab moves between the groups and the arrow keys
 * move within a group. The choice applies at once and is saved per user (see lib/theme/appearance).
 */
export function AppearanceSettings() {
  const { t } = useI18n();
  const { theme: selectedTheme, mode, resolvedMode, setAppearance } = useAppearance();
  return <section className="ipam-card settings-panel appearance-settings">
    <div className="panel-heading"><div><h2>{t('settings.appearanceTitle')}</h2><p className="panel-description">{t('settings.appearanceHint')}</p></div></div>
    <fieldset className="appearance-modes">
      <legend>{t('settings.themeMode')}</legend>
      <div className="appearance-mode-options">{modes.map(([value, Icon]) => <label key={value} className={mode === value ? 'active' : ''}>
        <input type="radio" name="appearance-mode" value={value} checked={mode === value} onChange={() => setAppearance({ mode: value })}/>
        <Icon size={15} aria-hidden="true"/>{t(`settings.mode.${value}`)}
      </label>)}</div>
    </fieldset>
    <fieldset className="appearance-themes">
      <legend>{t('settings.themeLabel')}</legend>
      <div className="appearance-theme-grid">{themes.map((theme) => {
        const tokens = themeTokens(theme, resolvedMode);
        const selected = theme.id === selectedTheme;
        const preview = { '--preview-canvas': tokens.canvas, '--preview-panel': tokens.panel, '--preview-sidebar': tokens['sb-bg'], '--preview-sidebar-text': tokens['sb-text'], '--preview-text': tokens.text, '--preview-muted': tokens['text-3'], '--preview-line': tokens.line, '--preview-accent': tokens.accent } as CSSProperties;
        return <label key={theme.id} className={`appearance-theme-card${selected ? ' selected' : ''}`} data-theme-option={theme.id}>
          <input type="radio" name="appearance-theme" value={theme.id} checked={selected} onChange={() => setAppearance({ theme: theme.id })}/>
          <span className="appearance-preview" style={preview} aria-hidden="true">
            <span className="appearance-preview-sidebar"><i/><i/><i/></span>
            <span className="appearance-preview-body"><span className="appearance-preview-panel"><b>Aa</b><i/><i/><em>{t('settings.themePreviewButton')}</em></span></span>
          </span>
          <span className="appearance-theme-meta">
            <strong>{t(`theme.${theme.id}`)}</strong>
            <small>{theme.source}</small>
          </span>
          {selected && <span className="appearance-theme-current"><Check size={13} aria-hidden="true"/>{t('settings.themeCurrent')}</span>}
        </label>;
      })}</div>
    </fieldset>
  </section>;
}
