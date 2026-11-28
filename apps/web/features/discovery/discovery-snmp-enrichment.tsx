'use client';

import { useState } from 'react';
import { Cpu } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format/date';
import { useUiText } from '@/components/ui/use-ui-text';
import {
  getDiscoverySnmp, updateDiscoverySnmp, type DiscoveryComparisonItem, type DiscoveryJob, type DiscoverySnmpCredentialOption,
  type DiscoverySnmpEnrichment, type DiscoverySnmpFieldName,
} from './api';

/**
 * D-P1a: optional SNMP enrichment per subnet. Off by default; an ADMIN picks one READ credential of a device on the
 * subnet's Site. A scan then tries only that credential, and only on hosts that answered ping or TCP.
 */

export const snmpCredentialOptionLabel = (item: DiscoverySnmpCredentialOption) =>
  `${item.deviceName}${item.managementIp ? ` (${item.managementIp})` : ''} · ${item.version === 'V2C' ? 'v2c' : item.version === 'V3' ? `v3${item.username ? ` ${item.username}` : ''}` : item.version}${item.label ? ` · ${item.label}` : ''}`;

export function DiscoverySnmpEnrichmentPanel({ subnetId, onError }: { subnetId: string; onError: (message: string) => void }) {
  const t = useUiText();
  const { hasRole } = useAuth();
  const admin = hasRole('ADMIN');
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const query = useQuery({ queryKey: ['discovery', 'snmp-enrichment', subnetId], queryFn: () => getDiscoverySnmp(subnetId), enabled: Boolean(subnetId) });
  const setting = query.data;

  const change = async (credentialId: string) => {
    setSaving(true);
    try {
      const saved = await updateDiscoverySnmp(subnetId, credentialId || null);
      qc.setQueryData(['discovery', 'snmp-enrichment', subnetId], saved);
      onError('');
    } catch (cause) { onError(cause instanceof Error ? cause.message : t('discovery.snmpEnrichment.couldNotSaveTheSnmp')); }
    finally { setSaving(false); }
  };

  if (!subnetId) return null;
  const options = setting ? [...(setting.credential && !setting.candidates.some((item) => item.id === setting.credential?.id) ? [setting.credential] : []), ...setting.candidates] : [];
  return <fieldset className="schedule-limits discovery-snmp-enrichment" disabled={!admin || saving}>
    <legend><Cpu size={13} aria-hidden="true" /> {t('discovery.snmpEnrichment.snmpEnrichment')}</legend>
    {query.isPending ? <small>{t('discovery.snmpEnrichment.loading')}</small> : query.isError || !setting ? <div className="ipam-alert error">{t('discovery.snmpEnrichment.couldNotLoadTheSnmp')}</div> : <>
      <label>{t('discovery.snmpEnrichment.readCredential')}<select className="context-toolbar-selector" aria-label={t('discovery.snmpEnrichment.snmpEnrichmentCredential')} value={setting.credentialId ?? ''} onChange={(event) => void change(event.target.value)}>
        <option value="">{t('discovery.snmpEnrichment.off')}</option>
        {options.map((item) => <option key={item.id} value={item.id}>{snmpCredentialOptionLabel(item)}</option>)}
      </select></label>
      <small id="discovery-snmp-help">{t('discovery.snmpEnrichment.whenOnEachRunOf')}</small>
      {!setting.candidates.length && !setting.credential && <small>{t('discovery.snmpEnrichment.thereAreNoEnabledSnmp')}</small>}
      {!admin && <small>{t('discovery.snmpEnrichment.onlyAnAdminCanChange')}</small>}
    </>}
  </fieldset>;
}

const failureLabels: Record<string, string> = {
  AUTH_FAILED: 'discovery.snmpEnrichment.failure.authFailed',
  TIMEOUT: 'discovery.snmpEnrichment.failure.timeout',
  ERROR: 'discovery.snmpEnrichment.failure.error',
};

/** Results table cell: what SNMP read from the host, with its provenance in each tooltip, or why it could not. */
export function DiscoverySnmpCell({ snmp }: { snmp?: DiscoverySnmpEnrichment | null }) {
  const t = useUiText();
  if (!snmp) return <span className="muted-cell">—</span>;
  const failure = failureLabels[snmp.status];
  if (failure) return <span className="state-badge rejected" title={snmp.errorCode}><i />{t(failure)}</span>;
  const provenance = (name: DiscoverySnmpFieldName) => {
    const field = snmp.fields[name];
    return field ? `SNMP · OID ${field.oid} · ${formatDateTime(field.observedAt)}` : undefined;
  };
  const { sysName, sysObjectId, entityModel, entitySerial, sysDescr } = snmp.fields;
  return <>
    {sysName && <strong title={provenance('sysName')}>{sysName.value}</strong>}
    {(entityModel || entitySerial) && <small>
      {entityModel && <span title={provenance('entityModel')}>{entityModel.value}</span>}
      {entityModel && entitySerial && ' · '}
      {entitySerial && <span className="mono" title={provenance('entitySerial')}>{`S/N ${entitySerial.value}`}</span>}
    </small>}
    {sysObjectId && <small className="mono" title={provenance('sysObjectId')}>{sysObjectId.value}</small>}
    {sysDescr && !sysName && <small title={provenance('sysDescr')}>{sysDescr.value.slice(0, 80)}</small>}
    {snmp.status === 'PARTIAL' && <small className="muted-cell">{t('discovery.snmpEnrichment.partialSnmpRead')}</small>}
  </>;
}

const comparisonLabels: Record<string, string> = {
  'snmp.sysName': 'sysName',
  'snmp.sysObjectId': 'sysObjectID',
  'snmp.sysDescr': 'sysDescr',
  'snmp.entityModel': 'entPhysicalModelName',
  'snmp.entitySerial': 'entPhysicalSerialNum',
};

/** Comparison detail for an `snmp.<field>` change, e.g. "SNMP entPhysicalSerialNum: FOC1 → FOC2"; null for other changes. */
export function snmpChangeText(change: string, item: Pick<DiscoveryComparisonItem, 'previous' | 'current'>): string | null {
  if (!change.startsWith('snmp.')) return null;
  const field = change.slice('snmp.'.length) as DiscoverySnmpFieldName;
  const before = item.previous?.snmp?.fields?.[field]?.value ?? '—';
  const after = item.current?.snmp?.fields?.[field]?.value ?? '—';
  return `SNMP ${comparisonLabels[change] ?? field}: ${before} → ${after}`;
}

const skipLabels: Record<string, string> = {
  SNMP_CREDENTIAL_UNAVAILABLE: 'discovery.snmpEnrichment.skip.credentialUnavailable',
  SNMP_CREDENTIAL_OUT_OF_SCOPE: 'discovery.snmpEnrichment.skip.credentialOutOfScope',
  SNMP_V2C_DISABLED: 'discovery.snmpEnrichment.skip.v2cDisabled',
  SNMP_KEYRING_UNAVAILABLE: 'discovery.snmpEnrichment.skip.keyringUnavailable',
};

/** One line under a run: how many hosts SNMP enriched or failed, or why enrichment was skipped. Nothing when it was off. */
export function DiscoverySnmpRunSummary({ job }: { job: Pick<DiscoveryJob, 'snmpCredentialId' | 'snmpEnrichedCount' | 'snmpFailedCount' | 'snmpSkippedReason'> }) {
  const t = useUiText();
  if (!job.snmpCredentialId) return null;
  if (job.snmpSkippedReason) {
    const skipKey = skipLabels[job.snmpSkippedReason];
    return <small className="discovery-failure-reason" role="note">{t('discovery.snmpEnrichment.runSkipped', undefined, { reason: skipKey ? t(skipKey) : job.snmpSkippedReason })}</small>;
  }
  return <small className="muted-cell">{t('discovery.snmpEnrichment.runSummary', undefined, { enriched: job.snmpEnrichedCount ?? 0, failed: job.snmpFailedCount ?? 0 })}</small>;
}
