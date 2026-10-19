import { recoverMutation } from '../../services/mutationRecovery';
import { requestWithTimeout } from '../../services/requestTimeout';

export interface Capabilities { can_share: boolean; can_manage: boolean }
export interface Account { id: string; full_name: string; username: string; can_share: boolean; access_version: number; is_active: boolean; department?: string }
export interface AccountPage { items: Account[]; total: number; page: number; has_more: boolean }
export interface AuditEntry { id: string; actor_name: string; actor_username: string; subject_name: string; subject_username: string; subject_id: string; action: string; changes: { before?: unknown; after?: unknown }; created_at: string }
export interface AuditPage { items: AuditEntry[]; next_cursor: string | null }
const read=<T,>(url:string,signal?:AbortSignal)=>requestWithTimeout<T>(url,{signal,cache:'no-store'});
export const accessApi = {
  capabilities:(signal?:AbortSignal)=>read<Capabilities>('/api/access/me',signal),
  accounts:(q:string,signal?:AbortSignal)=>read<Account[]>(`/api/access/users?q=${encodeURIComponent(q)}`,signal),
  list:(q:string,filter:string,page:number,signal?:AbortSignal)=>{
    const params=new URLSearchParams({page:String(page)});if(q.trim())params.set('q',q.trim());if(filter!=='all')params.set('shared',String(filter==='enabled'));
    return read<AccountPage>('/api/access/accounts?'+params,signal);
  },
  account:(id:string,signal?:AbortSignal)=>read<Account>('/api/access/users/'+id,signal),
  assign:(account:Account,enabled:boolean)=>recoverMutation<{can_share:boolean;access_version:number}>(
    ()=>requestWithTimeout(`/api/access/users/${account.id}/calendar-sharing`,{method:'PUT',body:JSON.stringify({enabled,expected_enabled:account.can_share,expected_version:account.access_version})}),
    async()=>{const latest=await requestWithTimeout<Account>('/api/access/users/'+account.id,{cache:'no-store'},5000);return{can_share:latest.can_share,access_version:latest.access_version};},
    latest=>latest.can_share===enabled&&latest.access_version===account.access_version+1,
  ),
  history:(target?:string,before?:string,signal?:AbortSignal)=>{
    const params=new URLSearchParams();if(target)params.set('target_id',target);if(before)params.set('before',before);
    return read<AuditPage>('/api/access/history?'+params,signal);
  },
};
