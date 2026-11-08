import {useEffect,useRef,useState} from 'react';
import {requestApi} from './api';

type LinkRecord={id:string;expiresAt:number;revokedAt:number|null;views:number};
type Created={id:string;url:string;expiresAt:number;customerPhone:string|null};
async function api(path:string,method='GET',body?:unknown){
  const response=await requestApi(path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})},30000);
  const data=await response.json();if(response.status===401)window.dispatchEvent(new Event('forme-account-expired'));
  if(!response.ok)throw new Error(data.error||'The share link could not be updated.');return data;
}
export default function ShareLook({lookId,disabled=false,kind='outfit'}:{lookId:string;disabled?:boolean;kind?:'outfit'|'jewellery'}){
  const subject=kind==='jewellery'?'jewellery look':'outfit';
  const [links,setLinks]=useState<LinkRecord[]>([]),[created,setCreated]=useState<Created|null>(null);
  const [days,setDays]=useState('30'),[consent,setConsent]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;void api(`/api/looks/${encodeURIComponent(lookId)}/shares`).then(data=>{if(alive.current)setLinks(data.shares);}).catch(e=>{if(alive.current)setError(e.message);}).finally(()=>{if(alive.current)setBusy(false);});return()=>{alive.current=false;};},[lookId]);
  async function create(){
    if(!consent||busy)return;setBusy(true);setError('');setNotice('');
    try{const result:Created=await api(`/api/looks/${encodeURIComponent(lookId)}/share`,'POST',{days:Number(days),sharingConsent:consent});if(!alive.current)return;setCreated(result);setConsent(false);setLinks(items=>[{id:result.id,expiresAt:result.expiresAt,revokedAt:null,views:0},...items]);}
    catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}
  }
  async function revoke(id:string){setBusy(true);setError('');setNotice('');try{await api(`/api/share/${encodeURIComponent(id)}`,'DELETE');if(!alive.current)return;setLinks(items=>items.map(link=>link.id===id?{...link,revokedAt:Date.now()}:link));if(created?.id===id)setCreated(null);setNotice('Link revoked. It can no longer open the outfit.');}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}}
  const message=created?`Here is your ${subject} preview: ${created.url}`:'';
  return <section className="share-look" aria-label={'Share saved '+subject}>
    <h3>Share this {subject}</h3><p>Anyone with the link can see this saved {subject} until it expires or you revoke it. Sharing uses no AI credits.</p>
    <label>Link expires after<select value={days} disabled={disabled||busy} onChange={e=>setDays(e.target.value)}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select></label>
    <label className="consent"><input type="checkbox" checked={consent} disabled={disabled||busy} onChange={e=>setConsent(e.target.checked)}/><span>The customer agrees to make this {subject} available through a share link.</span></label>
    <button className="button secondary" disabled={disabled||busy||!consent} onClick={()=>void create()}>Create {subject} link</button>
    {created&&<div className="created-share"><label>{kind==='jewellery'?'Jewellery share link':'Outfit share link'}<input readOnly value={created.url} onFocus={e=>e.target.select()}/></label><p>Expires {new Date(created.expiresAt).toLocaleDateString()}.</p><div className="customer-actions">
      {created.customerPhone&&<a className="button primary" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${created.customerPhone.replace(/\D/g,'')}?text=${encodeURIComponent(message)}`}>Share on WhatsApp</a>}
      <button className="button secondary" disabled={busy||disabled} onClick={async()=>{try{await navigator.clipboard.writeText(created.url);setNotice('Link copied.');}catch{setNotice('Select and copy the link above.');}}}>Copy link</button>
      {typeof navigator.share==='function'&&<button className="button secondary" disabled={busy||disabled} onClick={async()=>{try{await navigator.share({title:'Your '+subject+' preview',text:'Here is your '+subject+' preview.',url:created.url});}catch(e){if((e as Error).name!=='AbortError')setError('Sharing was unavailable. Copy the link instead.');}}}>Share using another app</button>}
    </div>{!created.customerPhone&&<p>This avatar has no customer mobile number. Copy the link or share using another app.</p>}</div>}
    {links.length>0&&<details><summary>Manage outfit links ({links.length})</summary><ul className="share-links">{links.map(link=><li key={link.id}><span>Link {link.id.slice(0,8)} · {link.revokedAt?'Revoked':link.expiresAt<=Date.now()?'Expired':`Expires ${new Date(link.expiresAt).toLocaleDateString()}`} · {link.views} views</span>{!link.revokedAt&&link.expiresAt>Date.now()&&<button className="button back-button" disabled={busy||disabled} aria-label={`Revoke link ${link.id.slice(0,8)}`} onClick={()=>void revoke(link.id)}>Revoke link</button>}</li>)}</ul><p>Link addresses are shown only when created. Existing links can be revoked here; create a new one if you need another address.</p></details>}
    {error&&<p role="alert" className="error-banner">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </section>;
}
