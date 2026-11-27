'use client';

import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import {
  getNotificationPreferences, listNotifications, markNotificationRead, markNotificationsRead,
  notificationTopics, profileKeys, saveNotificationPreference, type NotificationItem, type NotificationPreferenceChange, type NotificationTopic,
} from './api';
import styles from './notifications-panel.module.css';
import { ReportSubscriptions } from './report-subscriptions';

type Status = 'unread' | 'all';

export function NotificationsPanel({ userId }: { userId: string }) {
  const { t, formatDate } = useI18n();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('all');
  const [type, setType] = useState<NotificationTopic | ''>('');
  const [active, setActive] = useState<NotificationItem | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const listKey = profileKeys.notifications(userId);
  const preferenceKey = profileKeys.notificationPreferences(userId);

  const notifications = useInfiniteQuery({
    queryKey: profileKeys.notificationList(userId, status, type),
    queryFn: ({ pageParam }) => listNotifications(status, type, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const preferences = useQuery({ queryKey: preferenceKey, queryFn: getNotificationPreferences });
  const read = useMutation({
    mutationFn: (change: { id: string; read: boolean } | 'all') =>
      change === 'all' ? markNotificationsRead() : markNotificationRead(change.id, change.read),
    onSuccess: async (_value, change) => {
      setActive((current) => {
        if (!current) return null;
        if (change === 'all') return { ...current, readAt: current.readAt ?? new Date().toISOString() };
        return current.id === change.id ? { ...current, readAt: change.read ? current.readAt ?? new Date().toISOString() : null } : current;
      });
      await queryClient.invalidateQueries({ queryKey: listKey });
    },
  });
  const preference = useMutation({
    mutationFn: ({ type: topic, ...change }: { type: NotificationTopic } & NotificationPreferenceChange) => saveNotificationPreference(topic, change),
    onSuccess: (saved) => queryClient.setQueryData(preferenceKey, (items: typeof preferences.data) =>
      items?.map((item) => item.type === saved.type ? saved : item)),
  });
  const teamsAvailable = (preferences.data ?? []).some((item) => item.teamsAvailable);
  const emailAvailable = (preferences.data ?? []).some((item) => item.emailAvailable);
  const hasEmail = (preferences.data ?? []).some((item) => item.hasEmail);
  const rows = notifications.data?.pages.flatMap((page) => page.items) ?? [];
  const activeId = active?.id;
  useEffect(() => { if (activeId) heading.current?.focus(); }, [activeId]);

  const topicLabel = (value: string) => t(`notifications.type.${value.startsWith('ROLE_REQUEST_') ? 'ROLE_REQUEST' : value}`, value);
  const open = (item: NotificationItem, button: HTMLButtonElement) => {
    opener.current = button;
    setActive(item);
    if (!item.readAt) read.mutate({ id: item.id, read: true });
  };
  const close = () => {
    setActive(null);
    if (opener.current?.isConnected) opener.current.focus();
    else document.getElementById('notification-list-heading')?.focus();
  };

  return <div className={styles.workspace}>
    <section className="ipam-card page-heading-card" aria-labelledby="notification-list-heading">
      <div className="panel-heading">
        <div>
          <h2 id="notification-list-heading" tabIndex={-1}>{t('notifications.title')}</h2>
          <p className="panel-description">{t('notifications.description')}</p>
        </div>
        <button className="secondary-button" type="button" disabled={read.isPending} onClick={() => read.mutate('all')}>{t('notifications.markAll')}</button>
      </div>
      <div className={styles.filters}>
        <label>{t('notifications.status')}
          <select value={status} onChange={(event) => setStatus(event.target.value as Status)}>
            <option value="all">{t('notifications.all')}</option>
            <option value="unread">{t('notifications.unreadOnly')}</option>
          </select>
        </label>
        <label>{t('notifications.type')}
          <select value={type} onChange={(event) => setType(event.target.value as NotificationTopic | '')}>
            <option value="">{t('notifications.allTypes')}</option>
            {notificationTopics.map((topic) => <option key={topic} value={topic}>{topicLabel(topic)}</option>)}
          </select>
        </label>
      </div>
      {read.isError && <p className="ipam-alert error" role="alert">{t('notifications.readError')}</p>}
      {active && <section className={styles.detail} aria-labelledby="notification-detail-title">
        <div className="panel-heading">
          <h3 ref={heading} id="notification-detail-title" tabIndex={-1}>{active.title}</h3>
          <button className="icon-button" type="button" onClick={close} aria-label={t('notifications.close')}><X size={16} /></button>
        </div>
        <p>{active.message}</p>
        <time dateTime={active.createdAt}>{formatDate(active.createdAt)}</time>
        {active.href && <div className="form-actions"><a className="secondary-button" href={active.href}>{t('notifications.openSource')}</a></div>}
      </section>}
      {notifications.isPending && <p role="status">{t('common.loading')}</p>}
      {notifications.isError && <p className="ipam-alert error" role="alert">{t('notifications.loadError')} <button type="button" className="text-button" onClick={() => void notifications.refetch()}>{t('common.refresh')}</button></p>}
      {notifications.isSuccess && !rows.length && <p className="no-data">{t(status === 'unread' ? 'notifications.noUnread' : 'notifications.empty')}</p>}
      {rows.length > 0 && <ul className={styles.list}>
        {rows.map((item) => <li key={item.id} className={styles.item}>
          <div className={styles.summary}>
            <button type="button" className="text-button" disabled={read.isPending} aria-expanded={activeId === item.id} onClick={(event) => activeId === item.id ? close() : open(item, event.currentTarget)}>{item.title}</button>
            <span>{topicLabel(item.type)} · <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></span>
          </div>
          <span className="state-badge">{t(item.readAt ? 'notifications.read' : 'notifications.unread')}</span>
          <button type="button" className="secondary-button" disabled={read.isPending} onClick={() => read.mutate({ id: item.id, read: !item.readAt })}>{t(item.readAt ? 'notifications.markUnread' : 'notifications.markRead')}</button>
        </li>)}
      </ul>}
      {notifications.hasNextPage && <div className="form-actions"><button type="button" className="secondary-button" disabled={notifications.isFetchingNextPage} onClick={() => void notifications.fetchNextPage()}>{t(notifications.isFetchingNextPage ? 'common.loading' : 'notifications.loadMore')}</button></div>}
    </section>
    <section className="ipam-card" aria-labelledby="notification-preferences-heading">
      <div className="panel-heading">
        <div><h2 id="notification-preferences-heading"><Bell size={15} aria-hidden="true" /> {t('notifications.preferences')}</h2><p className="panel-description">{t('notifications.preferenceHint')}</p>{preferences.isSuccess && <p className="panel-description">{t(teamsAvailable ? 'notifications.teamsHint' : 'notifications.teamsUnavailable')}</p>}{preferences.isSuccess && <p className="panel-description">{t(!emailAvailable ? 'notifications.emailUnavailable' : hasEmail ? 'notifications.emailHint' : 'notifications.emailMissing')}</p>}</div>
      </div>
      {preferences.isPending && <p role="status">{t('common.loading')}</p>}
      {(preferences.isError || preference.isError) && <p className="ipam-alert error" role="alert">{t(preference.isError ? 'notifications.preferenceError' : 'notifications.preferencesLoadError')}</p>}
      <ul className={styles.list}>
        {(preferences.data ?? []).map((item) => <li className={styles.preference} key={item.type}>
          <label><input type="checkbox" checked={!item.muted} disabled={preference.isPending} onChange={(event) => preference.mutate({ type: item.type, muted: !event.target.checked })} /> {topicLabel(item.type)}</label>
          <label className={styles.channel}><input type="checkbox" aria-label={`${t('notifications.teams')}: ${topicLabel(item.type)}`} checked={Boolean(item.teams) && !item.muted} disabled={preference.isPending || item.muted || (!item.teamsAvailable && !item.teams)} onChange={(event) => preference.mutate({ type: item.type, teams: event.target.checked })} /> {t('notifications.teams')}</label>
          <label className={styles.channel}><input type="checkbox" aria-label={`${t('notifications.email')}: ${topicLabel(item.type)}`} checked={Boolean(item.email) && !item.muted} disabled={preference.isPending || item.muted || ((!item.emailAvailable || !item.hasEmail) && !item.email)} onChange={(event) => preference.mutate({ type: item.type, email: event.target.checked })} /> {t('notifications.email')}</label>
        </li>)}
      </ul>
    </section>
    <ReportSubscriptions userId={userId} />
  </div>;
}
