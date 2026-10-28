import { useEffect, useState } from "react";
import { requestApi } from "./api";
export type StoreUser = { id: string; name: string; email: string };
export type AccountState = { enabled: boolean; account: StoreUser | null };
export default function StoreAccount({disabled,available,onChange}:{disabled:boolean;available:boolean;onChange:(state:AccountState)=>void}) {
  const [state,setState]=useState<AccountState>({enabled:false,account:null});
  const [signupAllowed,setSignupAllowed]=useState(true);
  const [register,setRegister]=useState(false);
  const [email,setEmail]=useState(""); const [name,setName]=useState(""); const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  function update(next:AccountState){setState(next);onChange(next);}
  useEffect(()=>{let cancelled=false;requestApi("/api/account").then(async r=>{if(!r.ok)return;const data=await r.json();if(!cancelled){setSignupAllowed(data.signupAllowed!==false);update({enabled:data.enabled===true,account:data.account||null});}}).catch(()=>{});return()=>{cancelled=true;};},[]);
  useEffect(()=>{const expired=()=>update({enabled:true,account:null});window.addEventListener("forme-account-expired",expired);return()=>window.removeEventListener("forme-account-expired",expired);},[]);
  async function submit(){
    setBusy(true);setError("");
    try{const r=await requestApi(`/api/account/${register?"register":"login"}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,name})},20000);const data=await r.json();if(!r.ok)throw new Error(data.error);setPassword("");update({enabled:true,account:data.account});}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function logout(){setBusy(true);setError("");try{const r=await requestApi("/api/account/logout",{method:"POST"});if(!r.ok)throw new Error("Sign out failed. Please try again.");update({enabled:true,account:null});setPassword("");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  if(!state.enabled&&!available)return null;
  return <section className="store-account" aria-label="Store account">
    {state.account?<><div><strong>{state.account.name}</strong><p>{state.account.email} · Avatars saved to this store account</p></div><button className="button secondary" disabled={disabled||busy} onClick={()=>void logout()}>Sign out</button></>:<>
      <div><h2>{register?"Create your store account":"Sign in to your store"}</h2><p>Generate once. Reopen your customer avatars from any browser signed in to this account.</p></div>
      <form onSubmit={e=>{e.preventDefault();void submit();}}>
        {register&&<label>Store name<input autoComplete="organization" required maxLength={80} value={name} disabled={disabled||busy} onChange={e=>setName(e.target.value)}/></label>}
        <label>Account email<input type="email" autoComplete="username" required maxLength={254} value={email} disabled={disabled||busy} onChange={e=>setEmail(e.target.value)}/></label>
        <label>Account password<input type="password" autoComplete={register?"new-password":"current-password"} required minLength={register?12:1} maxLength={128} value={password} disabled={disabled||busy} onChange={e=>setPassword(e.target.value)}/></label>
        <button className="button primary" disabled={disabled||busy}>{busy?"Please wait…":register?"Create store account":"Sign in"}</button>
        {signupAllowed&&<button type="button" className="button back-button" disabled={disabled||busy} onClick={()=>{setRegister(!register);setError("");}}>{register?"Use an existing account":"Create an account"}</button>}
      </form>
    </>}
    {error&&<p role="alert" className="error-banner">{error}</p>}
  </section>;
}
