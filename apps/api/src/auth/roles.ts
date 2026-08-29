export const APPLICATION_ROLES = [
  'ADMIN',
  'NETWORK_OPERATOR',
  'SYSTEMS_OPERATOR',
  'AUDITOR',
  'READ_ONLY',
] as const;

export type ApplicationRole = (typeof APPLICATION_ROLES)[number];

export function isApplicationRole(value: string): value is ApplicationRole {
  return (APPLICATION_ROLES as readonly string[]).includes(value);
}
