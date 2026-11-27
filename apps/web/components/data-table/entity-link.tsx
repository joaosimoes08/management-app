import type { ReactNode } from 'react';
import { entityHref, type EntityRef } from '@/lib/routes';

export type EntityLinkProps = EntityRef & { className?: string; children?: ReactNode; 'aria-label'?: string };

/** A plain link to a device, IP, subnet, change or audit entry. Styling comes from `className` (e.g. `secondary-button`). */
export function EntityLink({ className, children, 'aria-label': ariaLabel, ...entity }: EntityLinkProps) {
  return <a className={className} href={entityHref(entity)} aria-label={ariaLabel}>{children ?? entity.label}</a>;
}
