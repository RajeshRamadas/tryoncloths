import CreditBadge from './CreditBadge';
import { useEffect, useRef, useState } from "react";
import { Settings2, X } from "lucide-react";
import { requestApi } from "./api";
import StaffManagement from "./StaffManagement";
export type StoreUser = { id: string; name: string; email: string; user?: {id:string; name:string; role:string}; org?:string };
type StoreChoice = {id:string; name:string; role:string};
export type AccountState = { enabled: boolean; account: StoreUser | null };
export default function StoreAccount({disabled,available,jewelleryEnabled=false,onChange}:{disabled:boolean;available:boolean;jewelleryEnabled?:boolean;onChange:(state:AccountState)=>void}) {
  const [state,setState]=useState<AccountState>({enabled:false,account:null});
  const [staffOpen,setStaffOpen]=useState(false);
  const [toolsOpen,setToolsOpen]=useState(false);
  const toolsDialog=useRef<HTMLDialogElement>(null);
  const [stores,setStores]=useState<StoreChoice[]>([]);
  const [signupAllowed,setSignupAllowed]=useState(true);
  const [register,setRegister]=useState(false);
  const [email,setEmail]=useState(""); const [name,setName]=useState(""); const [password,setPassword]=useState("");
  const [phone,setPhone]=useState("");const [gstin,setGstin]=useState("");
  const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  function update(next:AccountState){setState(next);setStaffOpen(false);setToolsOpen(false);onChange(next);}
  useEffect(()=>{
    const dialog=toolsDialog.current;
    if(!toolsOpen||!dialog)return;
    dialog.showModal();
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{dialog.close();document.body.style.overflow=previousOverflow;};
  },[toolsOpen]);
  async function refresh(){const r=await requestApi("/api/account");const data=await r.json();if(!r.ok)throw new Error(data.error);setStores(data.stores || []);setState({enabled:true,account:data.account});onChange({enabled:true,account:data.account});}
  useEffect(()=>{let cancelled=false;requestApi("/api/account").then(async r=>{if(!r.ok)return;const data=await r.json();if(!cancelled){setSignupAllowed(data.signupAllowed!==false);setStores(data.stores || []);update({enabled:data.enabled===true,account:data.account||null});}}).catch(()=>{});return()=>{cancelled=true;};},[]);
  useEffect(()=>{const expired=()=>update({enabled:true,account:null});window.addEventListener("forme-account-expired",expired);return()=>window.removeEventListener("forme-account-expired",expired);},[]);
  async function submit(){
    setBusy(true);setError("");
    try{const r=await requestApi(`/api/account/${register?"register":"login"}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,name,phone,gstin})},20000);const data=await r.json();if(!r.ok)throw new Error(data.error);setPassword("");setStores(data.stores || []);update({enabled:true,account:data.account});}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function switchStore(storeId:string){
    setBusy(true);setError("");
    try{const r=await requestApi("/api/auth/switch-store",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({storeId})});const data=await r.json();if(!r.ok)throw new Error(data.error);setStores(data.stores || []);update({enabled:true,account:data.account});}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function logout(){setBusy(true);setError("");try{const r=await requestApi("/api/account/logout",{method:"POST"});if(!r.ok)throw new Error("Sign out failed. Please try again.");update({enabled:true,account:null});setPassword("");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function keepDialogFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
    if(event.key!=="Tab")return;
    const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(element=>element.getClientRects().length>0);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
  if(!state.enabled&&!available)return null;
  return <section className="store-account" aria-label="Store account">
    {state.account?<><div className="store-identity"><div><strong>{state.account.name}</strong><CreditBadge key={state.account.id} accountId={state.account.id}/></div><p>{state.account.user ? `${state.account.user.name} · ${state.account.user.role}` : state.account.email}</p>{stores.length>1&&<label>Active store<select value={state.account.id} disabled={disabled||busy} onChange={e=>void switchStore(e.target.value)}>{stores.map(store=><option key={store.id} value={store.id}>{store.name} · {store.role}</option>)}</select></label>}</div><div className="store-account-actions"><button className="button secondary" disabled={disabled||busy} aria-haspopup="dialog" aria-expanded={toolsOpen} aria-controls="store-tools-dialog" onClick={()=>setToolsOpen(true)}><Settings2 size={16}/> Store tools</button><button className="button back-button" disabled={disabled||busy} onClick={()=>void logout()}>Sign out</button></div>
      <dialog ref={toolsDialog} id="store-tools-dialog" className="store-tools-dialog" aria-labelledby="store-tools-title" onKeyDown={keepDialogFocus} onClose={e=>{if(!e.currentTarget.open)setToolsOpen(false);}} onClick={e=>{if(e.target!==e.currentTarget)return;const box=e.currentTarget.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)setToolsOpen(false);}}>
        <header><div><h2 id="store-tools-title">Store tools</h2><p>{state.account.name}</p></div><button type="button" className="icon-button" aria-label="Close store tools" onClick={()=>setToolsOpen(false)}><X size={20}/></button></header>
        <nav aria-label="Store tools"><section><h3>Products & sharing</h3><div className="store-tool-links"><a href="/catalogue">Catalogue<span aria-hidden="true">Clothing, stock and prices</span></a>{jewelleryEnabled&&<a href="/jewellery-catalogue">Jewellery catalogue<span aria-hidden="true">Saved pieces and metals</span></a>}<a href="/whatsapp">WhatsApp<span aria-hidden="true">Share looks with customers</span></a></div></section>
        {["owner","manager"].includes(state.account.user?.role || "")&&<section><h3>Daily management</h3><div className="store-tool-links"><a href="/catalogue-photos">Catalogue photos<span aria-hidden="true">Prepare product images</span></a><a href="/size-charts">Size charts<span aria-hidden="true">Measurements and size advice</span></a><a href="/analytics">Analytics<span aria-hidden="true">Store activity and results</span></a><a href="/usage">Usage<span aria-hidden="true">Review credit usage</span></a><a href="/shopper-spending">Shopper spending<span aria-hidden="true">Set customer spending limits</span></a></div></section>}
        {state.account.user?.role==="owner"&&<section><h3>Store settings</h3><div className="store-tool-links"><a href="/billing">Billing<span aria-hidden="true">Plan, credits and invoices</span></a><a href="/branding">Branding<span aria-hidden="true">Logo, colours and contact details</span></a></div></section>}</nav>
        {["owner","manager"].includes(state.account.user?.role || "")&&<section className="store-team"><button className="button secondary" disabled={disabled||busy} aria-expanded={staffOpen} onClick={()=>setStaffOpen(!staffOpen)}>{staffOpen?"Close staff":"Staff"}</button>{staffOpen&&<StaffManagement key={state.account.id} account={state.account} disabled={disabled||busy} onUpdated={refresh}/>}</section>}
      </dialog>
    </>:<>
      <div><h2>{register?"Create your store account":"Sign in to your store"}</h2><p>Generate once. Reopen your customer avatars from any browser signed in to this account.</p></div>
      <form onSubmit={e=>{e.preventDefault();void submit();}}>
        {register&&<label>Store name<input autoComplete="organization" required maxLength={80} value={name} disabled={disabled||busy} onChange={e=>setName(e.target.value)}/></label>}
        {register&&<><p>Start a 14-day trial with 30 AI credits. No card required.</p><label>Mobile number (optional)<input type="tel" value={phone} disabled={disabled||busy} onChange={e=>setPhone(e.target.value)}/></label><label>Business GSTIN (optional)<input maxLength={15} value={gstin} disabled={disabled||busy} onChange={e=>setGstin(e.target.value)}/></label></>}
        <label>Account email<input type="email" autoComplete="username" required maxLength={254} value={email} disabled={disabled||busy} onChange={e=>setEmail(e.target.value)}/></label>
        <label>Account password<input type="password" autoComplete={register?"new-password":"current-password"} required minLength={register?12:1} maxLength={128} value={password} disabled={disabled||busy} onChange={e=>setPassword(e.target.value)}/></label>
        <button className="button primary" disabled={disabled||busy}>{busy?"Please wait…":register?"Create store account":"Sign in"}</button>
        {signupAllowed&&<button type="button" className="button back-button" disabled={disabled||busy} onClick={()=>{setRegister(!register);setError("");}}>{register?"Use an existing account":"Create an account"}</button>}
      </form>
    </>}
    {error&&<p role="alert" className="error-banner">{error}</p>}
  </section>;
}
