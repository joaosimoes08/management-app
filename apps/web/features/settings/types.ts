import type { BuildingWithRooms, InfrastructureAction } from '@/features/infrastructure/types';
import type { ReportFrequency, ReportSection } from '@/features/reports/report-labels';
import type { AppLocale } from '@/lib/i18n';

export type IpamAction = InfrastructureAction | 'DISCOVER' | 'IMPORT';
export type AccessGroupUser = { id: string; username: string; displayName?: string | null; email?: string | null };
export type AccessGroupMember = { userId: string; user: AccessGroupUser };
export type AccessGroupSiteAssignment = { siteId: string; site?: { id: string; name: string; code: string }; permissions: { permission: IpamAction }[] };
export type AccessGroup = {
  id: string;
  name: string;
  description?: string | null;
  siteAssignments: AccessGroupSiteAssignment[];
  members: AccessGroupMember[];
  infrastructurePermissions: InfrastructurePermission[];
};
export type InfrastructurePermission = {
  id: string;
  scopeType: 'SITE' | 'BUILDING' | 'ROOM';
  scopeId: string;
  permission: InfrastructureAction;
  group?: { id: string; name: string };
};
/** Raw AccessGroup row: what PATCH /settings/access-groups/:id answers. */
export type AccessGroupRecord = { id: string; name: string; description?: string | null; createdAt: string; updatedAt: string };
/** POST /settings/access-groups: the new group with its site assignments (no members yet). */
export type CreatedAccessGroup = AccessGroupRecord & { siteAssignments: AccessGroupSiteAssignment[] };
/** Raw AccessGroupMember row: what POST /settings/access-groups/:id/members answers. */
export type AccessGroupMemberRecord = { groupId: string; userId: string };
export type AccessGroupInput = { name: string; description?: string };
export type { BuildingWithRooms };

/** Application roles an ADMIN can grant in Settings → Users. */
export const applicationRoles = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY'] as const;
export type ApplicationRole = typeof applicationRoles[number];
/** A Site as GET /settings/organization lists it, with its counts. */
export type SettingsSite = { id: string; name: string; code: string; address?: string | null; city?: string | null; region?: string | null; country?: string | null; _count: { buildings: number; devices: number; vlans: number; subnets: number } };
export type OrganizationSettings = { organizationName?: string | null; organizationCode?: string | null; timezone: string; locale: AppLocale; setupCompleted: boolean };
/** GET /settings/organization. */
export type Organization = { settings: OrganizationSettings; sites: SettingsSite[] };
/** PATCH /settings/organization: the raw SystemSettings row (only the fields the web reads are listed). */
export type OrganizationSettingsRecord = OrganizationSettings & { id: string };
export type OrganizationInput = { name: string; code: string; timezone: string; locale: AppLocale };
/** GET/PATCH /settings/discovery (the API also sends profiles and limits, unused here). */
export type DiscoveryDefaults = { methods: string[]; tcpPorts: number[]; reverseDns: boolean; intervalHours: number; allowedCidrs: string[] };
export type AuditPolicy = { retentionDays: number; totalEvents: number; oldestEventAt?: string | null; lastCleanupAt?: string | null; lastCleanupDeletedCount?: number | null; nextCleanupAt?: string | null };
export type SnmpListenerSettings = { listenAll: boolean; selectedInterfaceIds: string[]; interfaces: { id: string; instanceId: string; name: string; address: string; internal: boolean; lastSeenAt: string }[]; updatedAt?: string | null; refreshSeconds: number; engineId?: string | null; engineIdSource?: 'ENV' | 'STORED' | null; trapPort?: number; v2cAllowed?: boolean };
export type ManagedUser = { externalId: string; username: string; displayName: string; email?: string | null; enabled: boolean; directRoles: ApplicationRole[]; inheritedRoles: ApplicationRole[]; effectiveRoles: ApplicationRole[]; pendingRoleRequest?: { id: string; requestedRoles: ApplicationRole[]; status: 'PENDING' | 'PROCESSING'; createdAt: string } | null };
/** PATCH /settings/users/:externalId/roles. */
export type UserRolesResult = { externalId: string; directRoles: ApplicationRole[]; inheritedRoles: ApplicationRole[]; effectiveRoles: ApplicationRole[]; reauthenticationRequired: boolean };
export type SiteInput = { name: string; code: string; address: string; city: string; region: string; country: string };
/** What the Settings page loads together: one loading state and one error, as before. */
export type SettingsCore = { organization: Organization; discovery: DiscoveryDefaults; audit?: AuditPolicy; snmpListeners?: SnmpListenerSettings };

type BackupRecord = { completedAt: string; recordedAt: string; reference?: string; notes?: string; recordedBy?: string };
/** GET /settings/backups and POST /settings/backups/checks. */
export type BackupState = { mechanism: string; integration: string; latestBackup: null | BackupRecord; latestRestoreVerification: null | (BackupRecord & { outcome: string }); restoreVerified: boolean };
export type BackupCheckInput = { kind: string; completedAt: string; reference?: string; notes?: string };

export type CadenceTier = 'T1' | 'T2' | 'T3';
/** GET/PATCH /critical-assets/cadence: weeks between reviews per tier. */
export type Cadence = Record<CadenceTier, number>;

export type DeliveryTarget = 'USER_NOTIFICATIONS' | 'GROUP_ALERTS';
export type ChannelKind = 'TEAMS' | 'EMAIL';
export type SmtpSecurity = 'TLS' | 'STARTTLS' | 'NONE';
export type SmtpView = { host: string; port: number; security: SmtpSecurity; username: string | null; from: string; passwordSet: boolean };
export type GroupDeliveryMissing = 'enabled' | 'destination' | 'minSeverity';
export type ChannelStatus = {
  kind: ChannelKind; target: DeliveryTarget; enabled: boolean; configured: boolean; minSeverity: 'CRITICAL' | 'HIGH' | null; updatedAt: string | null;
  /** EMAIL/USER_NOTIFICATIONS only: the SMTP server, without the password. */
  smtp?: SmtpView | null;
  /** EMAIL/GROUP_ALERTS only. */
  recipients?: string[]; serverConfigured?: boolean;
  /** GROUP_ALERTS only: what the channel still needs before it sends alerts (empty when ready). */
  delivery?: { ready: boolean; missing: GroupDeliveryMissing[] };
};
/** GET /settings/notification-channels. */
export type ChannelsResponse = {
  channels: ChannelStatus[]; keyringAvailable: boolean; publicLinks: boolean; maxAttempts: number; maxTotalAttempts?: number;
  /** True when no group channel can send operational alerts. */
  groupAlertsUnconfigured?: boolean;
};
/** PUT /settings/notification-channels/:kind/:target. Secrets are write-only. */
export type ChannelInput = {
  enabled: boolean; webhookUrl?: string; minSeverity?: 'CRITICAL' | 'HIGH'; recipients?: string[];
  smtp?: { host: string; port: number; security: SmtpSecurity; username: string | null; password?: string; from: string };
};
export type DeliveryStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';
export type DeliveryItem = {
  id: string; channel?: ChannelKind; target: DeliveryTarget; status: DeliveryStatus; topic: string; title: string; attempts: number;
  failureReason: string | null; createdAt: string; sentAt: string | null; nextAttemptAt: string | null;
  recipient: { username: string; displayName: string | null } | null;
};
/** GET /settings/notification-deliveries: cursor page with counts per status. */
export type DeliveryPage = { items: DeliveryItem[]; nextCursor: string | null; counts: Partial<Record<DeliveryStatus, number>> };
/** POST /settings/notification-channels/:kind/:target/test. */
export type ChannelTestResult = { deliveryId: string; status: DeliveryStatus; failureReason: string | null };
/** POST /settings/notification-deliveries/:id/retry: the delivery row, queued again. */
export type RetriedDelivery = DeliveryItem & { lastAttemptAt: string | null; alertId: string | null; recipient: { id: string; username: string; displayName: string | null } | null };

export type ScheduledReportRecipient = { userId: string; username: string; displayName: string | null; hasEmail: boolean; unsubscribedAt: string | null };
export type ScheduledReport = {
  id: string; name: string; enabled: boolean; frequency: ReportFrequency; dayOfWeek: number | null; dayOfMonth: number | null; hour: number; timezone: string;
  sections: ReportSection[]; siteIds: string[]; sendEmail: boolean; sendTeams: boolean; nextRunAt: string | null; lastRunAt: string | null;
  recipients: ScheduledReportRecipient[];
  lastRun: { id: string; trigger: 'SCHEDULE' | 'MANUAL'; periodStart: string; periodEnd: string; createdAt: string; outputs: number } | null;
};
export type ScheduledReportUser = { id: string; username: string; displayName: string | null; hasEmail: boolean };
/** GET /settings/scheduled-reports. */
export type ScheduledReportsResponse = {
  reports: ScheduledReport[]; users: ScheduledReportUser[]; sites: { id: string; name: string }[];
  channels: { email: boolean; teams: boolean }; publicLinks: boolean; maxRecipients: number;
};
export type ScheduledReportInput = {
  name: string; enabled: boolean; frequency: ReportFrequency; hour: number; timezone: string; dayOfWeek?: number; dayOfMonth?: number;
  sections: ReportSection[]; siteIds: string[]; recipientIds: string[]; sendEmail: boolean; sendTeams: boolean;
};
/** POST /settings/scheduled-reports/:id/run. */
export type ReportRunResult = { runId: string; periodStart: string; periodEnd: string; teams: string; recipients: { userId: string; siteIds: string[]; email: string }[] };
