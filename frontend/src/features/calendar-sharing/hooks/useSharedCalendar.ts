import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRangeCollection } from '../../../services/useRangeCollection';
import { ApiError } from '../../../services/api';
import { Share, SharedItem, SharedPage, sharingApi } from '../api';
import { permitted } from '../sharedItemUtils';

export function useSharedCalendar(share: Share, start: string, end: string, revision: number, accessEpoch: number) {
  const key = `${share.owner_id}:${start}:${end}:${share.version}:${accessEpoch}`;
  const fetchPage = useCallback((offset: number, signal: AbortSignal) => sharingApi.collection(share.owner_id, start, end, signal, offset), [share.owner_id, start, end]);
  const data = useRangeCollection<SharedItem, SharedPage>(key, revision, fetchPage);
  const items = useMemo(() => data.items.filter(item => permitted(item, share)), [data.items, share.share_events, share.share_tasks, share.share_notes]);
  return { ...data, items, visible: !!data.page && !data.error, pending: data.loading };
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
