'use client';

import { useId, useState } from 'react';
import { ImpactPanel } from '@/features/topology/impact-panel';
import type { ChangeItem } from './api';

/**
 * Step 34 — "Impacto" section of a change plan: what goes down if the plan's target device goes down.
 * Only DEVICE targets have a topology impact; with several, a picker chooses which one.
 */
export function PlanImpactSection({ items, label, siteId, defaultOpen = false }: { items: ChangeItem[]; label: (item: ChangeItem) => string; siteId?: string | null; defaultOpen?: boolean }) {
  const headingId = useId();
  const devices = items.filter((item) => item.entityType === 'DEVICE');
  const [open, setOpen] = useState(defaultOpen);
  const [picked, setPicked] = useState('');
  if (!devices.length) return null;
  const current = devices.find((item) => item.entityId === picked) ?? devices[0];
  return <section className="plan-impact" aria-labelledby={headingId} data-testid="plan-impact">
    <div className="change-section-heading panel-heading"><div><h3 id={headingId}>Impacto se o equipamento for abaixo</h3></div><button type="button" className="secondary-button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? 'Ocultar impacto' : 'Ver impacto'}</button></div>
    {open && <>
      {devices.length > 1 && <label className="impact-target-picker"><span>Equipamento</span><select className="context-toolbar-selector" value={current.entityId} onChange={(event) => setPicked(event.target.value)}>{devices.map((item) => <option key={item.entityId} value={item.entityId}>{label(item)}</option>)}</select></label>}
      <ImpactPanel target={{ kind: 'DEVICE', id: current.entityId }} siteId={siteId} headingId={headingId} />
    </>}
  </section>;
}
