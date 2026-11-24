'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { useUiText } from '@/components/ui/use-ui-text';
import { useOptionalToast } from '@/components/ui/toast';
import { ApiRequestError } from '@/lib/api/errors';
import { HealthThresholdsEditor, healthThresholdsEditorKey } from './thresholds-editor';
import {
  deviceHealthThresholdsKey, getDeviceHealthThresholds, getSiteHealthThresholds, putDeviceHealthThresholds, putSiteHealthThresholds,
  siteHealthThresholdsKey, useCanEditHealthThresholds, type Limits,
} from './thresholds-api';

type SiteRef = { id: string; name: string };

function LoadState({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useUiText();
  if (!error) return <p className="panel-description" role="status">{t('healthLimits.loading')}</p>;
  if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) return <p className="panel-description">{t('healthLimits.noAccess')}</p>;
  return <p className="ipam-scope-note" role="alert">{t('healthLimits.loadError')} <button type="button" className="text-button" onClick={retry}>{t('snmpHealth.panel.retry')}</button></p>;
}

/** Definições → Limites de saúde: one Site at a time. Every SNMP health reader sees it; only operators can change it. */
export function SiteHealthThresholdsSettings({ sites }: { sites: SiteRef[] }) {
  const t = useUiText();
  const toast = useOptionalToast();
  const queryClient = useQueryClient();
  const canEdit = useCanEditHealthThresholds();
  const [chosen, setChosen] = useState('');
  const siteId = chosen || sites[0]?.id || '';
  const query = useQuery({ queryKey: siteHealthThresholdsKey(siteId), queryFn: () => getSiteHealthThresholds(siteId), enabled: Boolean(siteId), retry: false });

  const save = async (body: Partial<Limits>) => {
    const saved = await putSiteHealthThresholds(siteId, body);
    queryClient.setQueryData(siteHealthThresholdsKey(siteId), saved);
    // Device views inherit from the Site, so their merged values are now stale.
    void queryClient.invalidateQueries({ queryKey: ['snmp', 'health-thresholds', 'device'] });
    toast?.success(t('healthLimits.title'), Object.keys(body).length ? t('healthLimits.saved') : t('healthLimits.resetDone'));
  };

  return <section className="ipam-card settings-panel health-limits-settings" aria-labelledby="health-limits-heading">
    <div className="panel-heading"><div><h2 id="health-limits-heading">{t('healthLimits.title')}</h2><p className="panel-description">{t('healthLimits.settingsHint')}</p></div><Activity size={19} aria-hidden="true" /></div>
    {!sites.length ? <p className="empty-context">{t('healthLimits.noSites')}</p> : <>
      <label className="health-limits-site">{t('healthLimits.site')}<select value={siteId} onChange={(event) => setChosen(event.target.value)}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
      {query.data ? <HealthThresholdsEditor key={healthThresholdsEditorKey(query.data)} data={query.data} canEdit={canEdit} onSave={save} formId="settings-health-form" actionsInToolbar /> : <LoadState error={query.error} retry={() => void query.refetch()} />}
    </>}
  </section>;
}

/** Device 360 → Limites de alerta: the device's own override, with the Site and default values it inherits. */
export function DeviceHealthThresholdsPanel({ deviceId }: { deviceId: string }) {
  const t = useUiText();
  const toast = useOptionalToast();
  const queryClient = useQueryClient();
  const canEdit = useCanEditHealthThresholds();
  const query = useDeviceHealthThresholds(deviceId);

  const save = async (body: Partial<Limits>) => {
    queryClient.setQueryData(deviceHealthThresholdsKey(deviceId), await putDeviceHealthThresholds(deviceId, body));
    toast?.success(t('healthLimits.title'), Object.keys(body).length ? t('healthLimits.saved') : t('healthLimits.resetDone'));
  };

  if (!query.data) return <LoadState error={query.error} retry={() => void query.refetch()} />;
  return <HealthThresholdsEditor key={healthThresholdsEditorKey(query.data)} data={query.data} canEdit={canEdit} onSave={save} />;
}

/** Shared by the limits panel and the history chart's limit lines (one request). */
export function useDeviceHealthThresholds(deviceId: string, enabled = true) {
  return useQuery({ queryKey: deviceHealthThresholdsKey(deviceId), queryFn: () => getDeviceHealthThresholds(deviceId), enabled: enabled && Boolean(deviceId), retry: false, staleTime: 30_000 });
}
