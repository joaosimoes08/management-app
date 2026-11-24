'use client';

import { AlertTriangle } from 'lucide-react';
import { useUiText } from '@/components/ui/use-ui-text';
import type { DiscoveryIdentity, DiscoveryIdentityCandidate, DiscoveryIdentityConfidence } from './api';
import { deviceHref } from './discovery-promote';

/**
 * D-P1c: identity candidates of a discovery result, read-only. Each candidate is an existing device the host most likely
 * is, with a confidence and the reasons behind it. Nothing here links, merges or changes anything: a candidate only
 * opens its device page.
 */

/** Reason codes that contradict the match rather than support it. */
export const CONTRADICTION_CODES = new Set(['SERIAL_MISMATCH']);
const KNOWN_REASONS = new Set(['SERIAL_MATCH', 'MANAGEMENT_IP_MATCH', 'SYSNAME_MATCH', 'SERIAL_MISMATCH']);
const KNOWN_CONFIDENCE = new Set<string>(['HIGH', 'MEDIUM', 'LOW']);
const confidenceTone: Record<DiscoveryIdentityConfidence, string> = { HIGH: 'approved', MEDIUM: 'pending', LOW: '' };
const confidenceRank: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export const hasContradiction = (candidate: DiscoveryIdentityCandidate) => candidate.reasons.some((reason) => CONTRADICTION_CODES.has(reason.code));

/** Sort key for the identity column: best confidence first when sorted descending; no candidate sorts as null. */
export function identitySortValue(identity: DiscoveryIdentity | null | undefined): number | null {
  const top = identity?.candidates?.[0];
  return top ? (confidenceRank[top.confidence] ?? 0) * 1000 + top.score : null;
}

/** The existing device the promote action warns about: the top candidate when it is HIGH and uncontradicted. */
export function likelyExistingDevice(identity: DiscoveryIdentity | null | undefined): DiscoveryIdentityCandidate | null {
  const top = identity?.candidates?.[0];
  return top && top.confidence === 'HIGH' && !hasContradiction(top) ? top : null;
}

function ConfidenceBadge({ confidence }: { confidence: DiscoveryIdentityConfidence }) {
  const t = useUiText();
  const known = KNOWN_CONFIDENCE.has(confidence);
  return <span className={`state-badge discovery-identity-confidence ${known ? confidenceTone[confidence] : ''}`.trim()} data-confidence={confidence}>
    <i />{known ? t(`discoveryIdentity.confidence.${confidence}`) : confidence}
  </span>;
}

function DeviceLink({ candidate }: { candidate: DiscoveryIdentityCandidate }) {
  const t = useUiText();
  return <a className="discovery-identity-device" href={deviceHref(candidate.siteId, candidate.deviceId)} aria-label={t('discoveryIdentity.openDevice', undefined, { name: candidate.deviceName })}>
    {candidate.deviceName}
  </a>;
}

function CandidateReasons({ candidate }: { candidate: DiscoveryIdentityCandidate }) {
  const t = useUiText();
  return <ul className="discovery-identity-reasons" aria-label={t('discoveryIdentity.reasonsFor', undefined, { name: candidate.deviceName })}>
    {candidate.reasons.map((reason, index) => {
      const contradiction = CONTRADICTION_CODES.has(reason.code);
      const label = KNOWN_REASONS.has(reason.code) ? t(`discoveryIdentity.reason.${reason.code}`) : reason.code;
      return <li key={`${reason.code}-${index}`} data-tone={contradiction ? 'bad' : 'ok'}>
        {contradiction && <AlertTriangle size={12} aria-hidden="true" />}
        <span>
          {contradiction && <strong className="discovery-identity-contradiction">{t('discoveryIdentity.contradiction')}</strong>}
          <small>{label}</small>
          {(reason.discovered || reason.registered) && <small className="mono discovery-identity-values">
            {t('discoveryIdentity.values', undefined, { discovered: reason.discovered || '—', registered: reason.registered || '—' })}
          </small>}
        </span>
      </li>;
    })}
  </ul>;
}

/** Results-table cell: a compact badge for the top candidate, and every candidate with its reasons behind a disclosure. */
export function DiscoveryIdentityCell({ identity }: { identity?: DiscoveryIdentity | null }) {
  const t = useUiText();
  const candidates = identity?.candidates ?? [];
  if (!candidates.length) return <span className="muted-cell">{t('discoveryIdentity.none')}</span>;
  const top = candidates[0];
  const topContradiction = hasContradiction(top);
  return <div className="discovery-identity">
    <span className="discovery-identity-top">
      <ConfidenceBadge confidence={top.confidence} />
      <DeviceLink candidate={top} />
      {topContradiction && <span className="discovery-identity-flag" role="note"><AlertTriangle size={12} aria-hidden="true" />{t('discoveryIdentity.contradiction')}</span>}
    </span>
    {identity?.ambiguous && <small className="muted-cell">{t('discoveryIdentity.ambiguous')}</small>}
    <details className="discovery-identity-details">
      <summary>{t(candidates.length === 1 ? 'discoveryIdentity.showReasons' : 'discoveryIdentity.showCandidates', undefined, { count: candidates.length })}</summary>
      <ol className="discovery-identity-list">
        {candidates.map((candidate) => <li key={candidate.deviceId}>
          <span className="discovery-identity-top"><ConfidenceBadge confidence={candidate.confidence} /><DeviceLink candidate={candidate} /></span>
          <CandidateReasons candidate={candidate} />
        </li>)}
      </ol>
      <small className="muted-cell">{t('discoveryIdentity.suggestionOnly')}</small>
    </details>
  </div>;
}

/** Hint beside "Promover a equipamento" when a HIGH candidate already exists. It never blocks the action. */
export function DiscoveryLikelyExistingHint({ identity }: { identity?: DiscoveryIdentity | null }) {
  const t = useUiText();
  const candidate = likelyExistingDevice(identity);
  if (!candidate) return null;
  return <small className="discovery-identity-hint" role="note">
    {t('discoveryIdentity.likelyExists')} <DeviceLink candidate={candidate} />
  </small>;
}
