import {useEffect,useState} from "react";
import {requestApi} from "./api";
export default function InviteAcceptance(){
  const [token]=useState(()=>{return window.location.hash.slice(1);});
  useEffect(()=>{window.history.replaceState(null,"","/invite");},[]);
  const [name,setName]=useState(""),[password,setPassword]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[done,setDone]=useState(false);
  async function accept(){setBusy(true);setError("");try{const r=await requestApi("/api/invites/accept",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,name,password})},20000);const data=await r.json();if(!r.ok)throw new Error(data.error);setPassword("");setDone(true);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <main className="invite-page"><h1>Join your store on Forme</h1>{done?<><p role="status">Invitation accepted. Sign in with your invited email and password.</p><a className="button primary" href="/">Go to sign in</a></>:!token?<><p role="alert">Open the complete invitation link from your email. If it has expired, ask your store owner for another invitation.</p><a href="/">Return to Forme</a></>:<>
    <p>New to Forme? Choose your own password. Already have an account? Use your current Forme password to add this store; your existing password will stay the same.</p>
    <form onSubmit={e=>{e.preventDefault();void accept();}}>
      <label>Your name<input required maxLength={80} autoComplete="name" value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label>
      <label>Forme password<input required type="password" autoComplete="current-password" minLength={12} maxLength={128} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label>
      <button className="button primary" disabled={busy}>{busy?"Joining…":"Accept invitation"}</button>
    </form>{error&&<p role="alert" className="error-banner">{error}</p>}
  </>}</main>;
}
