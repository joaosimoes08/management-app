'use client';

import { useQuery } from '@tanstack/react-query';
import { formatDateTime } from '@/lib/format/date';
import { getAttachableChangePlans, linkSnmpWriteToChangePlan } from './api';

/** Query key for the attachable plans of one device; invalidated after a SET is attached. */
export const attachableChangePlansKey = (deviceId: string) => ['snmp', 'attachable-change-plans', deviceId] as const;

/**
 * The attachable plans of one device. The SNMP page also calls it as soon as a SET can be previewed, so the list is
 * already cached when "Criar preview" returns and the prompt appears together with the preview, with no second round trip.
 */
export const useAttachableChangePlans = (deviceId: string, enabled = true) => useQuery({ queryKey: attachableChangePlansKey(deviceId), queryFn: () => getAttachableChangePlans(deviceId), enabled: enabled && Boolean(deviceId), staleTime: 30_000 });

const statusLabels = { APPROVED: 'Aprovada', IN_PROGRESS: 'Em curso' } as const;

/**
 * Step 30: offers to record a SET against an approved or in-progress change
 * plan whose window is open now and that covers this device. Renders nothing
 * when no plan qualifies or the list cannot be read, so the SET flow is unchanged.
 */
export function SnmpChangePlanAttach({ deviceId, value, onChange }: { deviceId: string; value: string; onChange: (planId: string) => void }) {
  const { data, isError } = useAttachableChangePlans(deviceId);
  if (isError || !data?.length) return null;
  return <label>
    <span>Associar a uma alteração</span>
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Não associar</option>
      {data.map((plan) => <option key={plan.id} value={plan.id}>{`${plan.title} · ${statusLabels[plan.status] ?? plan.status} · até ${formatDateTime(plan.plannedEndAt, { dateStyle: 'short', timeStyle: 'short' })}`}</option>)}
    </select>
    <small>Alterações aprovadas ou em curso com este equipamento e a janela aberta agora. A escrita fica registada na alteração.</small>
  </label>;
}

/** Runs the SET, then links it. A failed link never hides that the SET already ran. */
export async function executeAndAttach(execute: () => Promise<unknown>, writeId: string, planId: string) {
  await execute();
  if (!planId) return;
  try { await linkSnmpWriteToChangePlan(planId, writeId); }
  catch (reason) { throw new Error(`Escrita SNMP submetida, mas não foi associada à alteração: ${reason instanceof Error ? reason.message : 'erro desconhecido'}`); }
}
