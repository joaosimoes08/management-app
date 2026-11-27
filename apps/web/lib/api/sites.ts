import { apiFetch } from './client';
import type { PaginatedResponse } from './types';

/** The fields of a Site that pickers need. Features that show a Site's details keep their own richer types. */
export interface SiteOption {
  id: string;
  name: string;
}

/** GET /api/v1/sites?pageSize=100: the Site list shared by pickers outside the infrastructure feature. */
export function listSiteOptions(): Promise<PaginatedResponse<SiteOption>> {
  return apiFetch<PaginatedResponse<SiteOption>>('/api/v1/sites?pageSize=100');
}
