import type { ReactNode } from 'react';

export type EntityKind = 'device' | 'ip' | 'subnet' | 'change' | 'audit';

export type EntityRef = {
  kind: EntityKind;
  id: string;
  /** Visible text, and the search term for targets without a detail view. */
  label: string;
  siteId?: string | null;
  /** IPs open inside their subnet; without it the link falls back to an IPAM search. */
  subnetId?: string | null;
};

const query = (values: Record<string, string | null | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : '';
};

/**
 * Where an entity opens, using only routes that exist today:
 * - device → Mapa físico device panel (`/infraestrutura?tab=devices&deviceId=&focus=device`)
 * - subnet → IPAM subnet (`/ipam?subnetId=`)
 * - ip → IPAM subnet with the IP panel open (`/ipam?subnetId=&ipId=`)
 *
 * Alterações and Auditoria have no detail route, and an IP without its subnet
 * has no direct view: those link to the list page with `q=<term>`, the search
 * parameter of the shared table kit. The pages honour it once they move onto
 * the kit (Phase C); until then the link lands on the unfiltered list.
 */
export function entityHref(entity: Omit<EntityRef, 'label'> & { label?: string }): string {
  const siteId = entity.siteId ?? undefined;
  switch (entity.kind) {
    case 'device': return `/infraestrutura${query({ siteId, tab: 'devices', deviceId: entity.id, focus: 'device' })}`;
    case 'subnet': return `/ipam${query({ siteId, subnetId: entity.id })}`;
    case 'ip': return entity.subnetId ? `/ipam${query({ siteId, subnetId: entity.subnetId, ipId: entity.id })}` : `/ipam${query({ siteId, q: entity.label || entity.id })}`;
    case 'change': return `/alteracoes${query({ siteId, q: entity.label || entity.id })}`;
    case 'audit': return `/auditoria${query({ siteId, q: entity.id })}`;
  }
}

export type EntityLinkProps = EntityRef & { className?: string; children?: ReactNode; 'aria-label'?: string };

/** A plain link to a device, IP, subnet, change or audit entry. Styling comes from `className` (e.g. `secondary-button`). */
export function EntityLink({ className, children, 'aria-label': ariaLabel, ...entity }: EntityLinkProps) {
  return <a className={className} href={entityHref(entity)} aria-label={ariaLabel}>{children ?? entity.label}</a>;
}
