'use client';

import { SEVERITY_ORDER, severityMeanings, severityName } from './alert-meta';

export function SeverityTag({ severity }: { severity: string }) {
  const key = severity.toUpperCase();
  return <span className={`severity-tag ${key.toLowerCase()}`} title={severityMeanings[key]}>{severityName(key)}</span>;
}

/** Short legend, always visible: what each severity means and how fast to act. */
export function SeverityLegend() {
  return <section className="severity-legend open" aria-labelledby="severity-legend-title">
    <h3 id="severity-legend-title">O que significa cada severidade?</h3>
    <dl>{SEVERITY_ORDER.map((severity) => <div key={severity}><dt><SeverityTag severity={severity} /></dt><dd>{severityMeanings[severity]}</dd></div>)}</dl>
  </section>;
}
