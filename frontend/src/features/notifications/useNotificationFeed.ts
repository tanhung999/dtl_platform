import { useEffect, useState } from 'react';
import { notificationsApi } from './api';
import { useNotifications } from './NotificationsProvider';
import { NotificationFilter, NotificationPage, NotificationSource } from './types';
export function useNotificationFeed(enabled = true) {
  const { revision } = useNotifications();
  const [filter, chooseFilter] = useState<NotificationFilter>('all'), [source, chooseSource] = useState<NotificationSource | ''>('');
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]), [index, setIndex] = useState(0);
  const [data, setData] = useState<{ key: string; page: NotificationPage }>(), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const cursor = cursors[index], key = `${filter}/${source}/${cursor ?? ''}`;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController(); setPending(true); setError('');
    notificationsApi.list(filter, source, cursor, controller.signal).then(page => { if (!controller.signal.aborted) setData({ key, page }); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [key, revision, enabled]);
  return { page: data?.page, loading: enabled && !error && data?.key !== key, pending, error, filter, source, index,
    setFilter: (value: NotificationFilter) => { chooseFilter(value); setIndex(0); setCursors([undefined]); },
    setSource: (value: NotificationSource | '') => { chooseSource(value); setIndex(0); setCursors([undefined]); },
    newest: () => { setIndex(0); setCursors([undefined]); }, previous: () => setIndex(value => Math.max(0, value - 1)),
    next: () => { if (data?.page.next_cursor) { setCursors(value => [...value.slice(0, index + 1), data.page.next_cursor!]); setIndex(value => value + 1); } },
  };
}
