import {useEffect,useState} from "react";
import {requestApi} from "./api";
export function CreditHelp(){return <> <a href="/billing">Buy credits or upgrade</a></>;}
export default function Billing(){
  const [data,setData]=useState<{plan:string;status:string;balances:{ai:number;photo:number}}|null>(null),[error,setError]=useState("");
  useEffect(()=>{let cancelled=false;requestApi("/api/billing").then(async r=>{const body=await r.json();if(!r.ok)throw new Error(r.status===403?"Only a store owner can view billing. Ask your owner to add credits.":body.error);if(!cancelled)setData(body);}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[]);
  return <main className="invite-page"><a href="/">Back to Forme</a><h1>Billing</h1>{error?<p role="alert">{error}</p>:!data?<p role="status">Loading credits…</p>:<>
    <p>Plan: <strong>{data.plan}</strong> · {data.status}</p>
    <h2>{data.balances.ai} AI credits available</h2><p>{data.balances.photo} catalogue photo credits</p>
    <p>Each successful avatar or clothing generation uses one AI credit. Failed generations are refunded. Saved results and approved adaptation reuse are free.</p>
    <p>To buy credits or upgrade, contact your Forme administrator. Online checkout is not available yet.</p>
  </>}</main>;
}
