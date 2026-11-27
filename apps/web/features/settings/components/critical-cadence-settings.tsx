'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useUiText } from '@/components/ui/use-ui-text';
import { settingsText } from '../i18n';
import { getCriticalCadence, settingsKeys, settingsQueryOptions, updateCriticalCadence } from '../api';
import type { Cadence, CadenceTier as Tier } from '../types';

type SiteRef = { id: string; name: string };

const toDraft = (cadence: Cadence): Record<Tier, string> => ({ T1: String(cadence.T1), T2: String(cadence.T2), T3: String(cadence.T3) });

/** Review cadence per criticality tier for one Site (weeks between reviews). Admins only; the API enforces it too. */
export function CriticalCadenceSettings({ sites }: { sites: SiteRef[] }) {
  const { success, error: toastError } = useToast();
  const ui = useUiText();
  const queryClient = useQueryClient();
  const [siteId, setSiteId] = useState('');
  const [draft, setDraft] = useState<Record<Tier, string> | null>(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => { if (!siteId && sites[0]) setSiteId(sites[0].id); }, [sites, siteId]);
  const cadenceQuery = useQuery({ queryKey: settingsKeys.cadence(siteId), queryFn: () => getCriticalCadence(siteId), enabled: Boolean(siteId), ...settingsQueryOptions });
  const saveMutation = useMutation({ mutationFn: (cadence: Cadence) => updateCriticalCadence(siteId, cadence), onSuccess: (saved) => queryClient.setQueryData(settingsKeys.cadence(siteId), saved) });
  // The form edits a copy; every load of the Site's cadence replaces it.
  const [loadedAt, setLoadedAt] = useState(0);
  if (cadenceQuery.data && cadenceQuery.dataUpdatedAt !== loadedAt) { setLoadedAt(cadenceQuery.dataUpdatedAt); setDraft(toDraft(cadenceQuery.data)); }
  const loadError = cadenceQuery.error ? (cadenceQuery.error instanceof Error ? cadenceQuery.error.message : settingsText('settings.cadence.loadError')) : '';
  const error = actionError || loadError;
  const saving = saveMutation.isPending;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !siteId) return;
    const values = (['T1', 'T2', 'T3'] as Tier[]).map((tier) => Number(draft[tier]));
    if (values.some((value) => !Number.isInteger(value) || value < 1 || value > 52)) { setActionError(ui('settings.cadence.invalid')); return; }
    setActionError('');
    try {
      const saved = await saveMutation.mutateAsync({ T1: values[0], T2: values[1], T3: values[2] });
      setDraft(toDraft(saved));
      success(ui('settings.cadence.toast'), ui('settings.cadence.saved'));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ui('settings.cadence.saveError');
      setActionError(message);
      toastError(ui('settings.cadence.toast'), message);
    }
  };

  return <section className="ipam-card settings-panel critical-cadence-settings" aria-labelledby="critical-cadence-heading">
    <div className="panel-heading"><div><h2 id="critical-cadence-heading">{ui('settings.cadence.title')}</h2><p className="panel-description">{ui('settings.cadence.description')}</p></div></div>
    {error && <div className="ipam-alert error" role="alert">{error}</div>}
    {!sites.length ? <p className="empty-context">{ui('settings.cadence.noSites')}</p> : <form className="modal-form" onSubmit={save}>
      <label>{ui('settings.cadence.site')}<select value={siteId} onChange={(event) => { setSiteId(event.target.value); setDraft(null); setActionError(''); }}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
      {draft && <div className="form-row">
        {(['T1', 'T2', 'T3'] as Tier[]).map((tier) => <label key={tier}>{ui('settings.cadence.tierWeeks', undefined, { tier: ui(`settings.cadence.tier.${tier}`) })}<input type="number" min={1} max={52} inputMode="numeric" value={draft[tier]} onChange={(event) => setDraft({ ...draft, [tier]: event.target.value })} /></label>)}
      </div>}
      <div className="form-actions"><button type="submit" className="primary-button" disabled={saving || !draft}><Check size={14} /> {ui('settings.cadence.save')}</button></div>
    </form>}
  </section>;
}
