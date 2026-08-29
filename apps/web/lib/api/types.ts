/**
 * Envelope used by every paginated backend list endpoint
 * (e.g. GET /api/v1/sites, GET /api/v1/devices, GET /api/v1/settings/users).
 */
export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Error body returned by the API exception filter for non-2xx responses. */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
