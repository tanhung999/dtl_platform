import type { NotificationItem } from './types';

/** Keep ingestion time for internal notices and source time for external history. */
export function notificationTime(item: Pick<NotificationItem, 'source' | 'occurred_at' | 'created_at'>): string {
  if (item.source !== 'platform' && Number.isFinite(Date.parse(item.occurred_at))) {
    return item.occurred_at;
  }
  return item.created_at;
}
