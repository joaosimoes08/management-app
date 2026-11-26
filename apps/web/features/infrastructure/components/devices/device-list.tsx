'use client';

import { useEscapeClose } from '@/components/ui/use-escape-close';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import { Archive, Check, ChevronDown, Edit3, Plus, Server, Tags, X } from 'lucide-react';
import { TagChips } from '@/features/tags/tag-components';
import { EquipmentTypeIcon } from '../equipment-type-icon';
import { AssetImage } from '../asset-image';
import type { Device } from '../../types';
import type { DeviceModel, Rack, TierCounts } from '../../types';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { SnmpHealthSummaryItem } from '@/features/snmp/health/health-api';
import { isSnmpNetworkDevice } from '@/features/snmp/health/health-api';
import { SnmpHealthBadge } from '@/features/snmp/health/health-badge';
import { useUiText } from '@/components/ui/use-ui-text';

export interface DeviceListProps {
  devices: Device[];
  search: string;
  onSelect: (device: Device) => void;
  onEdit: (device: Device, animateEntry?: boolean) => void;
  onNew: () => void;
  onRetire: (device: Device) => void;
  canRetire: boolean;
  canEdit: boolean;
  selectedId?: string;
  models?: DeviceModel[];
  racks?: Rack[];
  onImport?: () => void;
  canImport?: boolean;
  /** Criticality tier filter ('' = all) and per-tier counts for the header; both optional. */
  tierFilter?: string;
  onTierFilterChange?: (tier: string) => void;
  tierCounts?: TierCounts;
  /** Step 36: filter controls (tag, saved views) shown first in the page toolbar, for every role. */
  toolbarFilters?: ReactNode;
  /** Filters shown in the card heading, next to the title (the equipment "Tipo" filter). */
  headingFilters?: ReactNode;
  /** Filter chip row (Estado, Tipo) shown under the heading. */
  filterChips?: ReactNode;
  /** Step 36: opens the tag editor of one device; omitted when the user cannot edit tags. */
  onEditTags?: (device: Device) => void;
  /** Per-row check for the tag button (NETWORK_OPERATOR only tags network equipment). */
  canEditTagsFor?: (device: Device) => boolean;
  /** SNMP Phase 2 step 10: health per device id (one Site-wide request); network rows show the badge when set. */
  health?: ReadonlyMap<string, SnmpHealthSummaryItem>;
  onBulkUpdate?: (ids: string[], changes: { status?: string; modelId?: string | null; rackId?: string | null }) => Promise<{ updated: number; updatedIds: string[]; failed: { id: string; message: string }[]; auditFailed: { id: string; message: string }[]; batchAuditFailed: boolean }>;
}

export function getPopoverAlignment(anchor: Pick<DOMRect, 'left' | 'right'>, viewportWidth: number, preferredWidth: number): 'left' | 'right' {
  const popupWidth = Math.min(preferredWidth, Math.max(0, viewportWidth - 32));
  return anchor.left + popupWidth > viewportWidth - 12 && anchor.right - popupWidth >= 12 ? 'right' : 'left';
}

/** Active device inventory of the site. */
export function DeviceList({ devices, search, onSelect, onEdit, onNew, onRetire, canRetire, canEdit, selectedId, models = [], racks = [], onImport, canImport = canEdit, onBulkUpdate, tierFilter = '', onTierFilterChange, tierCounts, toolbarFilters, headingFilters, filterChips, onEditTags, canEditTagsFor, health }: DeviceListProps) {
  const ui = useUiText();
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [modelId, setModelId] = useState('');
  const [rackId, setRackId] = useState('');
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);
  const [selectionMenuPhase, setSelectionMenuPhase] = useState<'closed' | 'open' | 'closing'>('closed');
  const [bulkPopoverPhase, setBulkPopoverPhase] = useState<'closed' | 'open' | 'closing'>('closed');
  const [selectionMenuAlignment, setSelectionMenuAlignment] = useState<'left' | 'right'>('left');
  const [bulkPopoverAlignment, setBulkPopoverAlignment] = useState<'left' | 'right'>('left');
  const selectionMenuRef = useRef<HTMLDivElement>(null);
  const bulkPopoverRef = useRef<HTMLDivElement>(null);
  const selectionTriggerRef = useRef<HTMLButtonElement>(null);
  const selectionMenuCloseTimer = useRef<number | null>(null);
  const restoreSelectionFocus = useRef(false);
  const visibleIds = devices.map((item) => item.id);
  const allVisible = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const someVisible = visibleIds.some((id) => selected.includes(id));
  const selectionMenuOpen = selectionMenuPhase === 'open';
  const bulkPopoverOpen = bulkPopoverPhase === 'open';
  useLayoutEffect(() => {
    const updatePopoverAlignment = () => {
      const anchor = selectionMenuRef.current?.getBoundingClientRect();
      if (!anchor) return;
      if (selectionMenuPhase !== 'closed') setSelectionMenuAlignment(getPopoverAlignment(anchor, window.innerWidth, 260));
      if (bulkPopoverPhase !== 'closed') setBulkPopoverAlignment(getPopoverAlignment(anchor, window.innerWidth, 440));
    };
    updatePopoverAlignment();
    window.addEventListener('resize', updatePopoverAlignment);
    return () => window.removeEventListener('resize', updatePopoverAlignment);
  }, [selectionMenuPhase, bulkPopoverPhase]);
  const closeSelectionMenu = (restoreFocus = false) => {
    if (selectionMenuCloseTimer.current !== null) window.clearTimeout(selectionMenuCloseTimer.current);
    restoreSelectionFocus.current = restoreFocus;
    setSelectionMenuPhase('closing');
    selectionMenuCloseTimer.current = window.setTimeout(() => {
      setSelectionMenuPhase('closed');
      selectionMenuCloseTimer.current = null;
    }, 140);
    if (restoreFocus) selectionTriggerRef.current?.focus();
  };
  const openBulkPopover = () => {
    if (selectionMenuCloseTimer.current !== null) window.clearTimeout(selectionMenuCloseTimer.current);
    selectionMenuCloseTimer.current = null;
    restoreSelectionFocus.current = false;
    setSelectionMenuPhase('closed');
    setBulkPopoverPhase('open');
  };
  const closeBulkPopover = (restoreFocus = false) => {
    if (selectionMenuCloseTimer.current !== null) window.clearTimeout(selectionMenuCloseTimer.current);
    restoreSelectionFocus.current = restoreFocus;
    setBulkPopoverPhase('closing');
    selectionMenuCloseTimer.current = window.setTimeout(() => {
      setBulkPopoverPhase('closed');
      selectionMenuCloseTimer.current = null;
    }, 140);
    if (restoreFocus) selectionTriggerRef.current?.focus();
  };
  useEffect(() => {
    if (selectionMenuOpen) selectionMenuRef.current?.querySelector<HTMLButtonElement>('.device-selection-menu [role="menuitem"]')?.focus();
    if (bulkPopoverOpen) (bulkPopoverRef.current?.querySelector<HTMLElement>('select,input') ?? bulkPopoverRef.current?.querySelector<HTMLElement>('button'))?.focus();
    if (!selectionMenuOpen && !bulkPopoverOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (selectionMenuRef.current && !selectionMenuRef.current.contains(event.target as Node)) {
        if (selectionMenuOpen) closeSelectionMenu();
        if (bulkPopoverOpen) closeBulkPopover();
      }
    };
    window.addEventListener('pointerdown', closeOutside);
    return () => window.removeEventListener('pointerdown', closeOutside);
  }, [selectionMenuOpen, bulkPopoverOpen]);
  useEffect(() => {
    if ((selectionMenuPhase !== 'closing' && bulkPopoverPhase !== 'closing') || !restoreSelectionFocus.current) return;
    selectionTriggerRef.current?.focus();
    restoreSelectionFocus.current = false;
  }, [selectionMenuPhase, bulkPopoverPhase]);
  useEffect(() => () => { if (selectionMenuCloseTimer.current !== null) window.clearTimeout(selectionMenuCloseTimer.current); }, []);
  useEscapeClose(() => {
    if (selectionMenuOpen) closeSelectionMenu(true);
    if (bulkPopoverOpen) closeBulkPopover(true);
  }, selectionMenuOpen || bulkPopoverOpen);
  const handleSelectionMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !selectionMenuOpen) return;
    const items = Array.from(selectionMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (currentIndex + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items[nextIndex].focus();
  };
  const selectVisible = () => setSelected((current) => [...new Set([...current, ...visibleIds])]);
  const selectAllVisibleAndEdit = () => {
    selectVisible();
    openBulkPopover();
  };
  const deselectVisible = () => setSelected((current) => current.filter((id) => !visibleIds.includes(id)));
  async function applyBulk() {
    const changes: { status?: string; modelId?: string | null; rackId?: string | null } = {};
    if (status) changes.status = status;
    if (modelId) changes.modelId = modelId === '__none__' ? null : modelId;
    if (rackId) changes.rackId = rackId === '__unplaced__' ? null : rackId;
    if (!Object.keys(changes).length) { setError('Seleciona pelo menos um campo para alterar.'); return; }
    const summary = Object.entries(changes).map(([key, value]) => `${key}: ${value ?? ui('infra.bulk.noValue')}`).join('\n');
    if (!(await askConfirm({ title: 'Atualizar equipamentos', message: `Atualizar ${selected.length} equipamentos com os seguintes campos?\n\n${summary}`, confirmLabel: 'Atualizar' }))) return;
    setError(''); setUpdating(true);
    try {
      const outcome = await onBulkUpdate?.(selected, changes);
      if (!outcome) return;
      const failedNames = outcome.failed.map(({ id, message }) => `${devices.find((item) => item.id === id)?.name ?? id}: ${message}`);
      const auditNames = outcome.auditFailed.map(({ id, message }) => `${devices.find((item) => item.id === id)?.name ?? id}: ${message}`);
      const messages = [];
      if (outcome.updated) messages.push(`${outcome.updated} guardado(s).`);
      if (failedNames.length) messages.push(`Não guardados: ${failedNames.join(' · ')}`);
      if (auditNames.length) messages.push(`Guardados, auditoria falhou: ${auditNames.join(' · ')}`);
      if (outcome.batchAuditFailed) messages.push('Auditoria do lote falhou; atualizações guardadas.');
      setError(messages.join(' · ') || 'Não foram guardadas atualizações.');
      setSelected(outcome.failed.map((item) => item.id));
      if (!outcome.failed.length) closeBulkPopover(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar os equipamentos selecionados.');
    } finally { setUpdating(false); }
  }
  return <>{confirmDialog}<section className="ipam-card">
    <div className="panel-heading"><div><h2>Equipamentos ativos</h2></div>{headingFilters}</div>
    {filterChips}
    {onTierFilterChange && <div className="summary-stats settings-audit-stats tier-filter" role="group" aria-label="Filtrar por criticidade">
      {([['', 'Todos', tierCounts ? tierCounts.T1 + tierCounts.T2 + tierCounts.T3 + tierCounts.none : undefined], ['T1', 'T1 · Vital', tierCounts?.T1], ['T2', 'T2 · Importante', tierCounts?.T2], ['T3', 'T3 · Padrão', tierCounts?.T3]] as const).map(([value, label, count]) => (
        <button key={value || 'all'} type="button" aria-pressed={tierFilter === value} className={tierFilter === value ? 'active' : ''} onClick={() => onTierFilterChange(tierFilter === value ? '' : value)}><strong>{count ?? '—'}</strong><span>{label}</span></button>
      ))}
    </div>}
    {(toolbarFilters || canEdit || (canImport && onImport)) && <PageToolbarPortal><div className="device-list-toolbar">
      {toolbarFilters}
      {canImport && onImport && <button className="secondary-button" type="button" onClick={onImport}>Importar CSV</button>}
      {canEdit && <div className="device-selection-dropdown" ref={selectionMenuRef} onKeyDown={handleSelectionMenuKeyDown}>
        <div className="device-selection-split" role="group" aria-label="Seleção de equipamentos">
        <button type="button" className={`device-selection-toggle${allVisible ? ' is-active' : ''}`} aria-pressed={allVisible} aria-label={allVisible ? 'Desselecionar todos os visíveis' : 'Selecionar todos os visíveis'} title={allVisible ? 'Desselecionar todos os visíveis' : 'Selecionar todos os visíveis'} disabled={!visibleIds.length} onClick={() => { if (allVisible) deselectVisible(); else selectVisible(); }}>
          {allVisible ? <X size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}<span className="toolbar-action-label">{allVisible ? 'Desselecionar todos' : 'Selecionar visíveis'}</span>
        </button>
        <button ref={selectionTriggerRef} type="button" className="device-selection-trigger" aria-label="Mais opções de seleção" title="Mais opções de seleção" aria-haspopup={bulkPopoverPhase !== 'closed' ? 'dialog' : 'menu'} aria-controls={selectionMenuOpen || selectionMenuPhase === 'closing' ? 'device-selection-menu' : bulkPopoverOpen || bulkPopoverPhase === 'closing' ? 'device-bulk-popover' : undefined} aria-expanded={selectionMenuOpen || bulkPopoverOpen} onClick={() => { if (selectionMenuOpen) closeSelectionMenu(); else if (bulkPopoverOpen) closeBulkPopover(); else { if (selectionMenuCloseTimer.current !== null) window.clearTimeout(selectionMenuCloseTimer.current); selectionMenuCloseTimer.current = null; restoreSelectionFocus.current = false; if (selectionMenuPhase === 'closing') setSelectionMenuPhase('closed'); if (bulkPopoverPhase === 'closing') setBulkPopoverPhase('closed'); setSelectionMenuPhase('open'); } }}>
          <ChevronDown size={13} aria-hidden="true" />
        </button>
        </div>
        {selectionMenuPhase !== 'closed' && <div id="device-selection-menu" className={`device-selection-menu${selectionMenuAlignment === 'right' ? ' align-right' : ''}${selectionMenuPhase === 'closing' ? ' closing' : ''}`} role="menu" inert={selectionMenuPhase === 'closing'} aria-hidden={selectionMenuPhase === 'closing'} aria-label="Opções de seleção de equipamentos">
          {allVisible
            ? <button type="button" role="menuitem" onClick={() => { deselectVisible(); closeSelectionMenu(true); }}><X size={14} aria-hidden="true" />Desselecionar todos os visíveis</button>
            : <button type="button" role="menuitem" onClick={selectAllVisibleAndEdit}><Check size={14} aria-hidden="true" />Selecionar todos os visíveis</button>}
          {someVisible && !allVisible && <button type="button" role="menuitem" onClick={() => { deselectVisible(); closeSelectionMenu(true); }}><X size={14} aria-hidden="true" />Desselecionar visíveis</button>}
          {selected.length > 0 && <button type="button" role="menuitem" onClick={openBulkPopover}><Edit3 size={14} aria-hidden="true" />Editar {selected.length} selecionado{selected.length === 1 ? '' : 's'}</button>}
        </div>}
        {bulkPopoverPhase !== 'closed' && <div id="device-bulk-popover" ref={bulkPopoverRef} className={`device-bulk-popover${bulkPopoverAlignment === 'right' ? ' align-right' : ''}${bulkPopoverPhase === 'closing' ? ' closing' : ''}`} role="dialog" aria-label={`Alterar ${selected.length} equipamentos selecionados`} inert={bulkPopoverPhase === 'closing'} aria-hidden={bulkPopoverPhase === 'closing'}>
          <div className="device-bulk-popover-heading"><strong>{selected.length} selecionado{selected.length === 1 ? '' : 's'}</strong><button type="button" className="device-bulk-popover-close" aria-label="Fechar ações em lote" onClick={() => closeBulkPopover(true)}><X size={14} /></button></div>
          <div className="device-bulk-toolbar">
            <label>Estado<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Sem alteração</option>{['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED', 'UNKNOWN'].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Modelo<select value={modelId} onChange={(event) => setModelId(event.target.value)}><option value="">Sem alteração</option><option value="__none__">Sem modelo</option>{models.map((item) => <option key={item.id} value={item.id}>{item.manufacturer} {item.model}</option>)}</select></label>
            <label className="device-bulk-location">Localização (bastidor)<select value={rackId} onChange={(event) => setRackId(event.target.value)}><option value="">Sem alteração</option><option value="__unplaced__">Sem bastidor</option>{racks.map((item) => <option key={item.id} value={item.id}>{item.room?.building?.name} / {item.room?.name} / {item.name}</option>)}</select></label>
            <div className="device-bulk-actions"><button type="button" className="primary-button" disabled={updating} onClick={() => void applyBulk()}>{updating ? 'A atualizar…' : 'Aplicar alterações'}</button><button type="button" className="secondary-button" disabled={updating} onClick={() => { setSelected([]); closeBulkPopover(true); }}>Limpar seleção</button></div>
          </div>
        </div>}
      </div>}
      {canEdit && <button className="primary-button" type="button" aria-label="Adicionar equipamento" title="Adicionar equipamento" onClick={onNew}><Plus size={14} aria-hidden="true" /> <span className="toolbar-add-label">Adicionar<span className="toolbar-action-label"> equipamento</span></span></button>}
    </div></PageToolbarPortal>}
    {error && <div role="status" className="ipam-alert">{error}</div>}
    {devices.map((device) => <div className={`host-row infra-device-row ${selectedId === device.id ? 'selected' : ''}`} key={device.id} onClick={() => onSelect(device)} aria-current={selectedId === device.id ? 'true' : undefined}>
      {canEdit && <input type="checkbox" aria-label={`Selecionar ${device.name}`} checked={selected.includes(device.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelected(event.target.checked ? [...selected, device.id] : selected.filter((id) => id !== device.id))} />}
      <span className="host-icon equipment-type-icon-frame">{device.frontAsset ?? device.model?.frontAsset ? <AssetImage asset={device.frontAsset ?? device.model?.frontAsset} alt={ui('infra.frontImageOf', undefined, { name: device.name })} className="catalog-icon" fallback={<EquipmentTypeIcon type={device.type} />} /> : <EquipmentTypeIcon type={device.type} />}</span>
      <span><strong>{device.name}</strong><small>{device.type} · {device.model ? `${device.model.manufacturer} ${device.model.model}` : 'Sem modelo'} · {device.managementIp || 'Sem IP de gestão'} · {device.rack ? `${device.rack.name} / ${device.rackUnitStart ?? '?'}U` : 'Por localizar'}</small><TagChips tags={device.tags} limit={4} /></span>
      {health && isSnmpNetworkDevice(device.type) && <SnmpHealthBadge item={health.get(device.id) ?? null} />}
      <em className="status-active">{device.status}</em>
      {(canEdit || canRetire || onEditTags) && <span className="row-actions">{onEditTags && (canEditTagsFor?.(device) ?? true) && <button type="button" className="icon-button subtle" aria-label={`Etiquetas de ${device.name}`} title="Etiquetas" onClick={(event) => { event.stopPropagation(); onEditTags(device); }}><Tags size={14} /></button>}{canEdit && <button type="button" className="icon-button subtle" aria-label={ui('infra.editNamed', undefined, { name: device.name })} onClick={(event) => { event.stopPropagation(); onEdit(device, event.detail > 0); }}><Edit3 size={14} /></button>}{canRetire && <button type="button" className="icon-button subtle" aria-label={ui('infra.reviewRetirementOf', undefined, { name: device.name })} onClick={(event) => { event.stopPropagation(); onRetire(device); }}><Archive size={14} /></button>}</span>}
    </div>)}
    {!devices.length && <div className="empty-context"><Server size={26} /><strong>{search ? 'Sem equipamentos correspondentes' : 'Não existem equipamentos ativos neste Site'}</strong></div>}
  </section></>;
}
