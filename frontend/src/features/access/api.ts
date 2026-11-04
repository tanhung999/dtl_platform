import { recoverMutation } from '../../services/mutationRecovery';
import { requestWithTimeout } from '../../services/requestTimeout';

export interface Capabilities { can_share: boolean; can_manage: boolean; can_assign_tasks: boolean; can_access_admin?: boolean }
export interface AssignmentScope { mode: 'current_department' | 'selected_departments'; department_ids: string[] }
export interface PlatformPolicy { permissions: string[]; access_version: number; can_assign_tasks: boolean; assignment_scope: AssignmentScope; home_department_id: string | null; departments: { id: string; name: string; is_active: boolean }[] }
export interface Account { id: string; full_name: string; username: string; can_share: boolean; access_version: number; is_active: boolean; department?: string }
export interface AccountPage { items: Account[]; total: number; page: number; has_more: boolean }
export interface AuditEntry { id: string; actor_name: string; actor_username: string; subject_name: string; subject_username: string; subject_id: string; action: string; changes: { before?: unknown; after?: unknown }; created_at: string }
export interface AuditPage { items: AuditEntry[]; next_cursor: string | null }
const read=<T,>(url:string,signal?:AbortSignal)=>requestWithTimeout<T>(url,{signal,cache:'no-store'});
export const accessApi = {
  platformPolicy:(id:string,signal?:AbortSignal)=>read<PlatformPolicy>(`/api/access/users/${id}/platform-permissions`,signal),
  savePlatformPolicy:(id:string,policy:PlatformPolicy,permissions:string[],assignment_scope:AssignmentScope)=>recoverMutation<PlatformPolicy>(
    ()=>requestWithTimeout(`/api/access/users/${id}/platform-permissions`,{method:'PUT',body:JSON.stringify({permissions,expected_permissions:policy.permissions,expected_version:policy.access_version,assignment_scope})}),
    ()=>read<PlatformPolicy>(`/api/access/users/${id}/platform-permissions`),
    latest=>latest.access_version===policy.access_version+1&&JSON.stringify([...latest.permissions].sort())===JSON.stringify([...permissions].sort())&&latest.assignment_scope.mode===assignment_scope.mode&&JSON.stringify([...latest.assignment_scope.department_ids].sort())===JSON.stringify([...assignment_scope.department_ids].sort()),
  ),
  capabilities:(signal?:AbortSignal)=>read<Capabilities>('/api/access/me',signal),
  accounts:(q:string,signal?:AbortSignal)=>read<Account[]>(`/api/access/users?q=${encodeURIComponent(q)}`,signal),
  list:(q:string,page:number,signal?:AbortSignal)=>{
    const params=new URLSearchParams({page:String(page)});if(q.trim())params.set('q',q.trim());
    return read<AccountPage>('/api/access/accounts?'+params,signal);
  },
  account:(id:string,signal?:AbortSignal)=>read<Account>('/api/access/users/'+id,signal),
  history:(target?:string,before?:string,signal?:AbortSignal)=>{
    const params=new URLSearchParams();if(target)params.set('target_id',target);if(before)params.set('before',before);
    return read<AuditPage>('/api/access/history?'+params,signal);
  },
};
