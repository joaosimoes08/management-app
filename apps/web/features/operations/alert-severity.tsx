'use client';

import { useUiText } from '@/components/ui/use-ui-text';
import { SEVERITY_ORDER, severityMeaning, severityName } from './alert-meta';

export function SeverityTag({ severity }: { severity: string }) {
  const t = useUiText();
  const key = severity.toUpperCase();
  return <span className={`severity-tag ${key.toLowerCase()}`} title={severityMeaning(key, t)}>{severityName(key, t)}</span>;
}

/** Short legend, always visible: what each severity means and how fast to act. */
export function SeverityLegend() {
  const t = useUiText();
  return <section className="severity-legend open" aria-labelledby="severity-legend-title">
    <h3 id="severity-legend-title">{t('operations.severity.legendTitle')}</h3>
    <dl>{SEVERITY_ORDER.map((severity) => <div key={severity}><dt><SeverityTag severity={severity} /></dt><dd>{severityMeaning(severity, t)}</dd></div>)}</dl>
  </section>;
}
