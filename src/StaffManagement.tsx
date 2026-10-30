import {useEffect,useState} from "react";
import {requestApi} from "./api";
import type {StoreUser} from "./StoreAccount";
type Member={id:string;name:string;email:string;role:string;disabled:number};
export default function StaffManagement({account,disabled,onUpdated}:{account:StoreUser;disabled:boolean;onUpdated:()=>Promise<void>}) {
  const [staff,setStaff]=useState<Member[]>([]),[email,setEmail]=useState(""),[role,setRole]=useState("staff");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const owner=account.user?.role==="owner";
  async function load(){const r=await requestApi("/api/staff");const data=await r.json();if(!r.ok)throw new Error(data.error);setStaff(data.staff);}
  useEffect(()=>{let cancelled=false;requestApi("/api/staff").then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);if(!cancelled)setStaff(data.staff);}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[account.id]);
  async function invite(){setBusy(true);setError("");setNotice("");try{const r=await requestApi("/api/invites",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,role})},20000);const data=await r.json();if(!r.ok)throw new Error(data.error);setEmail("");setNotice("Invitation emailed. The link expires in 7 days.");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function change(user:Member,patch:{role?:string;disabled?:boolean}){setBusy(true);setError("");setNotice("");try{const r=await requestApi(`/api/staff/${encodeURIComponent(user.id)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(patch)});const data=await r.json();if(!r.ok)throw new Error(data.error);await onUpdated();await load();setNotice("Staff access updated.");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <section className="staff-management" aria-label="Staff management">
    <h2>Staff · {account.name}</h2>
    <p>Invite staff to sign in with their own password. Disabling an account ends its sessions immediately.</p>
    <form onSubmit={e=>{e.preventDefault();void invite();}}>
      <label>Staff email<input type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} disabled={disabled||busy}/></label>
      <label>Invitation role<select value={role} onChange={e=>setRole(e.target.value)} disabled={disabled||busy}><option value="staff">Staff</option>{owner&&<><option value="manager">Manager</option><option value="owner">Owner</option></>}</select></label>
      <button className="button primary" disabled={disabled||busy}>Send invitation</button>
    </form>
    {error&&<p role="alert" className="error-banner">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <ul className="staff-list">{staff.map(user=><li key={user.id}>
      <div><strong>{user.name}</strong><p>{user.email} · {user.disabled?"Disabled":"Active"} · {user.role}</p></div>
      {(owner||user.role==="staff")&&<div className="staff-actions">
        {owner&&<label>Role for {user.name}<select value={user.role} disabled={disabled||busy} onChange={e=>void change(user,{role:e.target.value})}><option value="owner">Owner</option><option value="manager">Manager</option><option value="staff">Staff</option></select></label>}
        <button className="button secondary" disabled={disabled||busy} onClick={()=>void change(user,{disabled:!user.disabled})}>{user.disabled?"Enable":"Disable"} {user.name}</button>
      </div>}
    </li>)}</ul>
  </section>;
}
