'use client';

import { SEVERITY_ORDER, severityMeanings, severityName } from './alert-meta';

export function SeverityTag({ severity }: { severity: string }) {
  const key = severity.toUpperCase();
  return <span className={`severity-tag ${key.toLowerCase()}`} title={severityMeanings[key]}>{severityName(key)}</span>;
}

/** Short legend: what each severity means. Collapsed by default so it costs one line. */
export function SeverityLegend() {
  return <details className="severity-legend">
    <summary>O que significa cada severidade?</summary>
    <dl>{SEVERITY_ORDER.map((severity) => <div key={severity}><dt><SeverityTag severity={severity} /></dt><dd>{severityMeanings[severity]}</dd></div>)}</dl>
  </details>;
}
