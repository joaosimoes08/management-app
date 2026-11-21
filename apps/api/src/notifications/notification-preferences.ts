import type { Prisma } from '@simoes/database';

export enum NotificationTopic {
  ROLE_REQUEST = 'ROLE_REQUEST',
  CRITICAL_ASSET_ATTESTATION = 'CRITICAL_ASSET_ATTESTATION',
  LIFECYCLE_DATE = 'LIFECYCLE_DATE',
}

export async function unmutedRecipients(tx: Prisma.TransactionClient, userIds: string[], type: NotificationTopic) {
  if (!userIds.length) return [];
  const muted = new Set((await tx.notificationMute.findMany({
    where: { userId: { in: userIds }, type },
    select: { userId: true },
  })).map(({ userId }) => userId));
  return userIds.filter((id) => !muted.has(id));
}

export function notificationHref(notification: { type: string; sourceHref: string | null; roleRequestId: string | null }) {
  if (notification.sourceHref) return notification.sourceHref;
  if (notification.type.startsWith('ROLE_REQUEST_')) {
    return notification.roleRequestId ? `/perfil?tab=roles&requestId=${notification.roleRequestId}` : '/perfil?tab=roles';
  }
  if (notification.type === NotificationTopic.CRITICAL_ASSET_ATTESTATION) return '/attestacao-ativos';
  if (notification.type === NotificationTopic.LIFECYCLE_DATE) return '/infraestrutura?tab=lifecycle';
  return null;
}
