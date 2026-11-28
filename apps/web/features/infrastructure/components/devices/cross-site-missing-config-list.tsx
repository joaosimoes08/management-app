'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Server } from 'lucide-react';
import { listMissingConfigDevices, type MissingConfigDevice } from '../../api';
import { EquipmentTypeIcon } from '../equipment-type-icon';
import { useUiText } from '@/components/ui/use-ui-text';
import { portugueseText, type InfrastructureText } from '../../infrastructure-text';

const PAGE_SIZE = 50;

function modelLabel(model: MissingConfigDevice['model'], ui: InfrastructureText = portugueseText): string {
  if (!model) return ui('infrastructure.crossSiteMissingConfigList.noModel');
  return typeof model === 'string' ? model : `${model.manufacturer ?? ''} ${model.model ?? ''}`.trim() || ui('infrastructure.crossSiteMissingConfigList.noModel');
}

/**
 * Cross-site list behind a bell alert that spans several Sites (`?missingConfig=…&allSites=1`). Reads
 * GET /devices/missing-config without a siteId, so its total is the bell's count. Each row opens the device's own link,
 * which switches to its Site and opens the editor on the missing tab.
 */
export function CrossSiteMissingConfigList({ config, label }: { config: string; label: string }) {
  const ui = useUiText();
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['infrastructure', 'devices', 'missing-config', config, page],
    queryFn: () => listMissingConfigDevices(config, page, PAGE_SIZE),
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const siteCount = data?.siteCount ?? new Set(items.map((item) => item.siteId)).size;
  const heading = ui('infra.missingConfigHeading', undefined, { devices: ui('infra.deviceCount', undefined, { count: total }), sites: ui('infra.siteCount', undefined, { count: siteCount }) });

  return <section className="ipam-card cross-site-missing-config" aria-labelledby="cross-site-missing-config-heading">
    <div className="panel-heading"><div><h2 id="cross-site-missing-config-heading">{isLoading ? ui('infrastructure.crossSiteMissingConfigList.loading') : heading}</h2></div></div>
    {isError && <div role="status" className="ipam-alert error">{ui('infrastructure.crossSiteMissingConfigList.couldNotLoadTheDevices')}</div>}
    {items.map((item) => <a key={item.id} className="host-row infra-device-row cross-site-missing-config-row" href={item.href}>
      <span className="host-icon equipment-type-icon-frame"><EquipmentTypeIcon type={item.type} /></span>
      <span><strong>{item.name}</strong><small>{item.type} · {modelLabel(item.model, ui)} · {item.rackName ? `${item.rackName} / ${item.rackUnitStart ?? '?'}U` : ui('infrastructure.crossSiteMissingConfigList.notPlaced')}</small></span>
      <span className="cross-site-missing-config-site">{item.siteName ?? ui('infrastructure.crossSiteMissingConfigList.noSite')}</span>
      <em className="status-active">{item.status}</em>
    </a>)}
    {!isLoading && !isError && !items.length && <div className="empty-context"><Server size={26} /><strong>{ui('infrastructure.crossSiteMissingConfigList.noDevicesMissing')}</strong></div>}
    {totalPages > 1 && <div className="ip-history-pagination"><button type="button" className="secondary-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>{ui('common.previous')}</button><span>{page} / {totalPages}</span><button type="button" className="secondary-button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>{ui('common.next')}</button></div>}
  </section>;
}
