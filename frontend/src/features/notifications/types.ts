export type NotificationSource = 'platform' | 'bookingreports' | 'workflows' | 'itam';
export type NotificationFilter = 'all' | 'unread' | 'hidden';
export const SOURCE_LABELS: Record<NotificationSource, string> = { platform: 'Cá nhân', bookingreports: 'Booking Reports', workflows: 'Workflows', itam: 'Quản lý tài sản' };
export interface NotificationItem {
  id: string; source: NotificationSource; kind: string; title: string; body: string;
  resource_type: string; resource_id: string; state: 'active' | 'changed' | 'completed' | 'deleted' | 'overdue';
  due_at: string | null; occurred_at: string; created_at: string;
  read_at: string | null; dismissed_at: string | null; snoozed_until: string | null;
}
export interface NotificationPage { items: NotificationItem[]; has_more: boolean; next_cursor: string | null; server_now: string }
export interface NotificationSummary { unread_count: number; preview: NotificationItem[]; server_now: string }
export interface NotificationPreferences { task_reminders: boolean; bookingreports: boolean; workflows: boolean; itam: boolean; version: number; connected: Record<Exclude<NotificationSource, 'platform'>, boolean> }
