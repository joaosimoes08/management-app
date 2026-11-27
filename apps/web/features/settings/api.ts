import { apiDownload, apiFetch } from '@/lib/api/client';
import type { PaginatedResponse, SuccessResponse } from '@/lib/api/types';
import type { Site } from '@/features/infrastructure/types';
import type {
  AccessGroup, AccessGroupInput, AccessGroupMemberRecord, AccessGroupRecord, AccessGroupSiteAssignment, AccessGroupUser, ApplicationRole, AuditPolicy, BackupCheckInput, BackupState,
  Cadence, ChannelInput, ChannelKind, ChannelStatus, ChannelTestResult, ChannelsResponse, CreatedAccessGroup, DeliveryPage, DeliveryStatus, DeliveryTarget, DiscoveryDefaults, IpamAction,
  ManagedUser, Organization, OrganizationInput, OrganizationSettingsRecord, ReportRunResult, RetriedDelivery, ScheduledReport, ScheduledReportInput, ScheduledReportsResponse, SettingsCore,
  SiteInput, SnmpListenerSettings, UserRolesResult,
} from './types';

export const settingsKeys = {
  all: ['settings'] as const,
  groups: ['settings', 'access-groups'] as const,
  users: ['settings', 'access-group-users'] as const,
  /** Organization, Discovery defaults, audit policy and SNMP listeners, loaded together for the roles that may read them. */
  core: (admin: boolean, auditor: boolean) => ['settings', 'core', { admin, auditor }] as const,
  managedUsers: (page: number, search: string) => ['settings', 'users', { page, search }] as const,
  roleRequestsAll: ['settings', 'role-requests'] as const,
  roleRequests: (status: string, page: number) => ['settings', 'role-requests', { status, page }] as const,
  backups: ['settings', 'backups'] as const,
  cadence: (siteId: string) => ['settings', 'critical-cadence', siteId] as const,
  notificationChannels: ['settings', 'notification-channels'] as const,
  notificationDeliveries: (status: DeliveryStatus | '', channel: ChannelKind | '') => ['settings', 'notification-deliveries', { status, channel }] as const,
  scheduledReports: ['settings', 'scheduled-reports'] as const,
};

/** Settings panels reload every time they open, as they did before React Query. */
export const settingsQueryOptions = { staleTime: 0 } as const;

export const listAccessGroups = (siteId?: string) => apiFetch<AccessGroup[]>(`/api/v1/settings/access-groups${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`);
export const listAccessGroupUsers = () => apiFetch<AccessGroupUser[]>('/api/v1/settings/access-group-users');
const accessGroupPath = (groupId: string) => `/api/v1/settings/access-groups/${groupId}`;
export const createAccessGroup = (body: AccessGroupInput & { siteIds: string[] }) => apiFetch<CreatedAccessGroup>('/api/v1/settings/access-groups', { method: 'POST', body: JSON.stringify(body) });
export const updateAccessGroup = (groupId: string, body: AccessGroupInput) => apiFetch<AccessGroupRecord>(accessGroupPath(groupId), { method: 'PATCH', body: JSON.stringify(body) });
export const deleteAccessGroup = (groupId: string) => apiFetch<SuccessResponse>(accessGroupPath(groupId), { method: 'DELETE' });
export const addAccessGroupMember = (groupId: string, userId: string) => apiFetch<AccessGroupMemberRecord>(`${accessGroupPath(groupId)}/members`, { method: 'POST', body: JSON.stringify({ userId }) });
export const removeAccessGroupMember = (groupId: string, userId: string) => apiFetch<SuccessResponse>(`${accessGroupPath(groupId)}/members/${userId}`, { method: 'DELETE' });
/** Adds the Site to the group, or replaces its permissions. Answers the assignment with its site and permissions (null only if it vanished meanwhile). */
export const assignAccessGroupSite = (groupId: string, siteId: string, permissions: IpamAction[]) => apiFetch<AccessGroupSiteAssignment | null>(`${accessGroupPath(groupId)}/sites/${siteId}`, { method: 'PUT', body: JSON.stringify({ permissions }) });
export const removeAccessGroupSite = (groupId: string, siteId: string) => apiFetch<SuccessResponse>(`${accessGroupPath(groupId)}/sites/${siteId}`, { method: 'DELETE' });

export type RoleRequestStatus = 'PENDING' | 'PROCESSING' | 'APPROVED' | 'REJECTED';
export interface RoleRequestPerson { id: string; username: string; displayName?: string | null; email?: string | null }
export interface RoleRequestItem {
  id: string;
  requestedRoles: string[];
  /** Kept as string: a status added later must still render. */
  status: RoleRequestStatus | string;
  createdAt: string;
  processingAt?: string | null;
  decidedAt?: string | null;
  user?: RoleRequestPerson | null;
  reviewer?: RoleRequestPerson | null;
}
/** GET /settings/role-requests: the standard page plus the PENDING count across every page. */
export type RoleRequestPage = PaginatedResponse<RoleRequestItem> & { pendingTotal?: number };

/** ADMIN queue. `status` is a comma list; the API defaults to PENDING,PROCESSING and answers 400 ROLE_REQUEST_STATUS_INVALID otherwise. */
export const listRoleRequests = ({ status, page = 1, pageSize = 20 }: { status?: string; page?: number; pageSize?: number } = {}) => {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) query.set('status', status);
  return apiFetch<RoleRequestPage>(`/api/v1/settings/role-requests?${query.toString()}`);
};
export const decideRoleRequest = (id: string, decision: 'APPROVE' | 'REJECT') => apiFetch<RoleRequestItem>(`/api/v1/settings/role-requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ decision }) });

export const getOrganization = () => apiFetch<Organization>('/api/v1/settings/organization');
export const updateOrganization = (body: OrganizationInput) => apiFetch<OrganizationSettingsRecord>('/api/v1/settings/organization', { method: 'PATCH', body: JSON.stringify(body) });
export const getDiscoveryDefaults = () => apiFetch<DiscoveryDefaults>('/api/v1/settings/discovery');
export const updateDiscoveryDefaults = (body: DiscoveryDefaults) => apiFetch<DiscoveryDefaults>('/api/v1/settings/discovery', { method: 'PATCH', body: JSON.stringify(body) });
export const getAuditPolicy = () => apiFetch<AuditPolicy>('/api/v1/settings/audit-policy');
export const updateAuditPolicy = (retentionDays: number) => apiFetch<AuditPolicy>('/api/v1/settings/audit-policy', { method: 'PATCH', body: JSON.stringify({ retentionDays }) });
export const getSnmpListeners = () => apiFetch<SnmpListenerSettings>('/api/v1/settings/snmp-listeners');
export const updateSnmpListeners = (body: { listenAll: boolean; interfaceIds: string[] }) => apiFetch<SnmpListenerSettings>('/api/v1/settings/snmp-listeners', { method: 'PATCH', body: JSON.stringify(body) });
/** Everything the Settings page shows outside its own panels. Audit policy (ADMIN, AUDITOR) and SNMP listeners (ADMIN) only for the roles the API allows. */
export const getSettingsCore = async (admin: boolean, auditor: boolean): Promise<SettingsCore> => {
  const [organization, discovery, audit, snmpListeners] = await Promise.all([
    getOrganization(),
    getDiscoveryDefaults(),
    admin || auditor ? getAuditPolicy() : Promise.resolve(undefined),
    admin ? getSnmpListeners() : Promise.resolve(undefined),
  ]);
  return { organization, discovery, audit, snmpListeners };
};

/** Sites live under the IPAM controller; Settings creates, edits and deletes them. Create/update answer the raw Site row. */
export const createSite = (body: SiteInput) => apiFetch<Site>('/api/v1/sites', { method: 'POST', body: JSON.stringify(body) });
export const updateSite = (id: string, body: SiteInput) => apiFetch<Site>(`/api/v1/sites/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const deleteSite = (id: string) => apiFetch<SuccessResponse>(`/api/v1/sites/${id}`, { method: 'DELETE' });

export const listManagedUsers = (page: number, search: string) => apiFetch<PaginatedResponse<ManagedUser>>(`/api/v1/settings/users?${new URLSearchParams({ page: String(page), pageSize: '20', ...(search.trim() ? { search: search.trim() } : {}) })}`);
export const updateUserRoles = (externalId: string, roles: ApplicationRole[]) => apiFetch<UserRolesResult>(`/api/v1/settings/users/${externalId}/roles`, { method: 'PATCH', body: JSON.stringify({ roles }) });

export const getBackupStatus = () => apiFetch<BackupState>('/api/v1/settings/backups');
export const recordBackupCheck = (body: BackupCheckInput) => apiFetch<BackupState>('/api/v1/settings/backups/checks', { method: 'POST', body: JSON.stringify(body) });
export const downloadExport = (kind: string, format: string, siteId: string) => apiDownload(`/api/v1/exports/${kind}/${format}${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`, `${kind}-export.${format}`);
export const downloadAnsibleInventory = (siteId: string) => apiDownload(`/api/v1/exports/ansible${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`, 'ansible-inventory.json');

export const getCriticalCadence = (siteId: string) => apiFetch<Cadence>(`/api/v1/critical-assets/cadence?siteId=${encodeURIComponent(siteId)}`);
export const updateCriticalCadence = (siteId: string, cadence: Cadence) => apiFetch<Cadence>(`/api/v1/critical-assets/cadence?siteId=${encodeURIComponent(siteId)}`, { method: 'PATCH', body: JSON.stringify(cadence) });

const channelsPath = '/api/v1/settings/notification-channels';
export const getNotificationChannels = () => apiFetch<ChannelsResponse>(channelsPath);
/** Answers the channel as GET lists it. */
export const updateNotificationChannel = (kind: ChannelKind, target: DeliveryTarget, body: ChannelInput) => apiFetch<ChannelStatus>(`${channelsPath}/${kind}/${target}`, { method: 'PUT', body: JSON.stringify(body) });
/** Removes the stored secret and settings; answers the channel as it now is. */
export const clearNotificationChannel = (kind: ChannelKind, target: DeliveryTarget) => apiFetch<ChannelStatus>(`${channelsPath}/${kind}/${target}`, { method: 'DELETE' });
export const testNotificationChannel = (kind: ChannelKind, target: DeliveryTarget) => apiFetch<ChannelTestResult>(`${channelsPath}/${kind}/${target}/test`, { method: 'POST' });
export const listNotificationDeliveries = ({ status, channel, cursor }: { status?: DeliveryStatus | ''; channel?: ChannelKind | ''; cursor?: string }) => {
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (channel) query.set('channel', channel);
  if (cursor) query.set('cursor', cursor);
  return apiFetch<DeliveryPage>(`/api/v1/settings/notification-deliveries${query.size ? `?${query}` : ''}`);
};
export const retryNotificationDelivery = (id: string) => apiFetch<RetriedDelivery>(`/api/v1/settings/notification-deliveries/${id}/retry`, { method: 'POST' });

const reportsPath = '/api/v1/settings/scheduled-reports';
export const listScheduledReports = () => apiFetch<ScheduledReportsResponse>(reportsPath);
export const createScheduledReport = (body: ScheduledReportInput) => apiFetch<ScheduledReport>(reportsPath, { method: 'POST', body: JSON.stringify(body) });
export const updateScheduledReport = (id: string, body: ScheduledReportInput) => apiFetch<ScheduledReport>(`${reportsPath}/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteScheduledReport = (id: string) => apiFetch<SuccessResponse>(`${reportsPath}/${id}`, { method: 'DELETE' });
export const runScheduledReport = (id: string) => apiFetch<ReportRunResult>(`${reportsPath}/${id}/run`, { method: 'POST' });
export const downloadScheduledReportCsv = (id: string, filename: string) => apiDownload(`${reportsPath}/${id}/csv`, filename);
