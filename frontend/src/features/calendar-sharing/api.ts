import { recoverMutation } from '../../services/mutationRecovery';
import { requestWithTimeout } from '../../services/requestTimeout';
export interface Share { id: string; owner_id: string; viewer_id: string; name: string; username: string; version: number; share_events: boolean; share_tasks: boolean; share_notes: boolean }
export interface ShareState { id: string | null; version: number; active: boolean; share_events: boolean; share_tasks: boolean; share_notes: boolean }
export type Scope = Pick<Share, 'share_events' | 'share_tasks' | 'share_notes'>;
export interface SharedItem { id: string; title: string; kind: 'event' | 'note' | 'task'; starts_at?: string; ends_at?: string; is_all_day?: boolean; due_date?: string; due_time?: string; priority?: string; is_completed?: boolean; note_id?: string; note_color?: string; content?: string; color?: string; location?: string }
export interface SharedPage extends Scope { items: SharedItem[]; total: number; truncated: boolean }
const base = '/api/calendar-sharing';
const read = <T,>(url: string, signal?: AbortSignal) => requestWithTimeout<T>(url, { signal, cache: 'no-store' });
export const sharingApi = {
  state: (viewer: string, signal?: AbortSignal) => read<ShareState>(`${base}/mine/${viewer}`, signal),
  mine: (signal?: AbortSignal) => read<Share[]>(base + '/mine', signal),
  received: (signal?: AbortSignal) => read<Share[]>(base + '/received', signal),
  save:(viewer:string,scope:Scope,version:number,id?:string)=>recoverMutation<ShareState>(
    async()=>{const row=await requestWithTimeout<Share>(`${base}/mine/${viewer}`,{method:'PUT',body:JSON.stringify({share_events:scope.share_events,share_tasks:scope.share_tasks,share_notes:scope.share_notes,expected_version:version,expected_id:id})});return{...row,active:true};},
    ()=>requestWithTimeout<ShareState>(`${base}/mine/${viewer}`,{cache:'no-store'},5000),
    state=>state.active&&(state.version===version+1||state.version===version)&&(!id||state.id===id)&&state.share_events===scope.share_events&&state.share_tasks===scope.share_tasks&&state.share_notes===scope.share_notes,
  ),
  revoke:(row:Share)=>recoverMutation<ShareState>(
    async()=>{await requestWithTimeout(`${base}/mine/${row.viewer_id}?expected_version=${row.version}&expected_id=${row.id}`,{method:'DELETE'});return{...row,active:false};},
    ()=>requestWithTimeout<ShareState>(`${base}/mine/${row.viewer_id}`,{cache:'no-store'},5000),
    state=>!state.active&&state.id===row.id&&state.version>=row.version+1,
  ),
  collection: (owner: string, start: string, end: string, signal?: AbortSignal) => read<SharedPage>(`${base}/view/${owner}?${new URLSearchParams({ start, end })}`, signal),
  detail: (owner: string, item: SharedItem, signal?: AbortSignal) => read<SharedItem>(`${base}/view/${owner}/${item.kind}/${item.id}`, signal),
};
