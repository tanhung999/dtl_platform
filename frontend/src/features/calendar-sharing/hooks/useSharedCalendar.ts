import { useEffect, useState } from 'react';
import { ApiError } from '../../../services/api';
import { Share, SharedItem, SharedPage, sharingApi } from '../api';
import { permitted } from '../sharedItemUtils';

export function useSharedCalendar(share: Share, start: string, end: string, revision: number, accessEpoch: number) {
  const rangeKey = `${share.owner_id}:${start}:${end}`;
  const queryKey = `${rangeKey}:${share.version}`;
  const [saved, setSaved] = useState<{ rangeKey: string; queryKey: string; accessEpoch: number; page: SharedPage }>();
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setPending(true); setError('');
    sharingApi.collection(share.owner_id, start, end, controller.signal).then(page => {
      if (!controller.signal.aborted) setSaved({ rangeKey, queryKey, accessEpoch, page });
    }).catch(reason => {
      if (!controller.signal.aborted) { setSaved(undefined); setError(reason.message); }
    }).finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [queryKey, revision, accessEpoch, rangeKey, share.owner_id, start, end]);
  const visible = saved?.queryKey === queryKey && saved.accessEpoch === accessEpoch;
  const items = saved?.rangeKey === rangeKey ? saved.page.items.filter(item => permitted(item, share)) : [];
  return { items, visible, pending, error, total: saved?.page.total, truncated: saved?.page.truncated };
}

export function useSharedDetail(ownerId: string, item: SharedItem | undefined, revision: number, accessEpoch: number,
                                onUnavailable: () => void) {
  const key = item ? `${ownerId}:${item.kind}:${item.id}` : '';
  const [saved, setSaved] = useState<{ key: string; epoch: number; item: SharedItem }>();
  const [error, setError] = useState(''), [pending, setPending] = useState(false);
  useEffect(() => {
    if (!item) return;
    const controller = new AbortController(); setError(''); setPending(true);
    sharingApi.detail(ownerId, item, controller.signal).then(value => {
      if (!controller.signal.aborted) setSaved({ key, epoch: accessEpoch, item: value });
    }).catch(reason => {
      if (!controller.signal.aborted) {
        setSaved(undefined);
        if (reason instanceof ApiError && [403, 404].includes(reason.status)) onUnavailable();
        else setError(reason.message);
      }
    }).finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [key, revision, accessEpoch, ownerId, onUnavailable]);
  return { item: saved?.key === key && saved.epoch === accessEpoch ? saved.item : undefined, error, pending };
}
