'use client';

import { useQuery } from '@tanstack/react-query';
import { formatDateTime } from '@/lib/format/date';
import { getAttachableChangePlans, linkSnmpWriteToChangePlan } from './api';
import { useUiText } from '@/components/ui/use-ui-text';

/** Query key for the attachable plans of one device; invalidated after a SET is attached. */
export const attachableChangePlansKey = (deviceId: string) => ['snmp', 'attachable-change-plans', deviceId] as const;

/**
 * The attachable plans of one device. The SNMP page also calls it as soon as a SET can be previewed, so the list is
 * already cached when "Criar preview" returns and the prompt appears together with the preview, with no second round trip.
 */
export const useAttachableChangePlans = (deviceId: string, enabled = true) => useQuery({ queryKey: attachableChangePlansKey(deviceId), queryFn: () => getAttachableChangePlans(deviceId), enabled: enabled && Boolean(deviceId), staleTime: 30_000 });

const statusLabels = { APPROVED: 'snmp.changePlanAttach.status.approved', IN_PROGRESS: 'snmp.changePlanAttach.status.inProgress' } as const;

/**
 * Step 30: offers to record a SET against an approved or in-progress change
 * plan whose window is open now and that covers this device. Renders nothing
 * when no plan qualifies or the list cannot be read, so the SET flow is unchanged.
 */
export function SnmpChangePlanAttach({ deviceId, value, onChange }: { deviceId: string; value: string; onChange: (planId: string) => void }) {
  const t = useUiText();
  const { data, isError } = useAttachableChangePlans(deviceId);
  if (isError || !data?.length) return null;
  return <label>
    <span>{t('snmp.changePlanAttach.attachToAChange')}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{t('snmp.changePlanAttach.doNotAttach')}</option>
      {data.map((plan) => <option key={plan.id} value={plan.id}>{t('snmp.changePlanAttach.option', undefined, { title: plan.title, status: plan.status in statusLabels ? t(statusLabels[plan.status]) : plan.status, end: formatDateTime(plan.plannedEndAt, { dateStyle: 'short', timeStyle: 'short' }) })}</option>)}
    </select>
    <small>{t('snmp.changePlanAttach.approvedOrInProgressChanges')}</small>
  </label>;
}

/** Runs the SET, then links it. A failed link never hides that the SET already ran. */
export async function executeAndAttach(t: ReturnType<typeof useUiText>, execute: () => Promise<unknown>, writeId: string, planId: string) {
  await execute();
  if (!planId) return;
  try { await linkSnmpWriteToChangePlan(planId, writeId); }
  catch (reason) { throw new Error(t('snmp.changePlanAttach.linkFailed', undefined, { reason: reason instanceof Error ? reason.message : t('snmp.changePlanAttach.unknownError') })); }
}
