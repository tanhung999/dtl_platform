import { useEffect, useState } from 'react';
import type { UserBrief } from '../../types';
import { requestWithTimeout } from '../../services/requestTimeout';

export function UserPicker({ value, onChange, multiple=false, endpoint='/api/colleagues', disabled=false, label='Người theo dõi' }:{value:UserBrief[];onChange:(users:UserBrief[])=>void;multiple?:boolean;endpoint?:string;disabled?:boolean;label?:string}) {
  const [query,setQuery]=useState(''), [results,setResults]=useState<UserBrief[]>([]);
  useEffect(()=>{ if(query.trim().length<2){setResults([]);return;} const controller=new AbortController(); const timer=setTimeout(()=>requestWithTimeout<UserBrief[]>(`${endpoint}?${new URLSearchParams({q:query})}`,{signal:controller.signal}).then(setResults).catch(()=>{}),250); return()=>{clearTimeout(timer);controller.abort();};},[query,endpoint]);
  const add=(user:UserBrief)=>{onChange(multiple?[...value.filter(v=>v.id!==user.id),user]:[user]);setQuery('');setResults([]);};
  return <div className="people-picker"><label>{label}<input className="form-input" value={query} disabled={disabled} placeholder="Tìm theo tên hoặc tài khoản…" onChange={e=>setQuery(e.target.value)}/></label>
    {!!value.length&&<div className="people-picker-chips">{value.map(user=><span className="people-chip" key={user.id}>{user.full_name}<button type="button" disabled={disabled} aria-label={`Xóa ${user.full_name}`} onClick={()=>onChange(value.filter(v=>v.id!==user.id))}>×</button></span>)}</div>}
    {!!results.length&&<div className="people-picker-results">{results.filter(r=>!value.some(v=>v.id===r.id)).map(user=><button type="button" key={user.id} onClick={()=>add(user)}><strong>{user.full_name}</strong><span>@{user.username}{user.department?` · ${user.department}`:''}</span></button>)}</div>}
  </div>;
}
