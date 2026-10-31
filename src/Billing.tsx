import {useEffect,useState} from 'react';
import {billingJson,billingDownload,loadCheckout,openCheckout} from './billing-api';
export function CreditHelp(){return <> <a href="/billing">Buy credits or upgrade</a></>;}
type Details={name:string;address:string;billingEmail:string;stateCode:string;gstin:string};
type Summary={plan:string;status:string;trialEndsAt:number|null;balances:{ai:number;photo:number};paymentsAvailable:boolean;subscription:{status:string;currentPeriodEnd:number|null}|null;plans:{id:string;credits:number;monthly:number;annual:number;monthlyAvailable:boolean;annualAvailable:boolean}[];packs:{id:string;credits:number;amount:number}[]};
type Invoice={id:string;number:string;createdAt:number;emailedAt:number|null};
const money=(paise:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(paise/100);
const date=(value:number|null)=>value?new Date(value).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata'}):'Not scheduled';
export default function Billing(){
 const [data,setData]=useState<Summary|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[annual,setAnnual]=useState(false);
 const [details,setDetails]=useState<Details>({name:'',address:'',billingEmail:'',stateCode:'',gstin:''}),[saved,setSaved]=useState(false),[invoices,setInvoices]=useState<Invoice[]>([]);
 async function refresh(){const next=await billingJson('/api/billing');setData(next);setInvoices((await billingJson('/api/billing/invoices')).invoices);}
 useEffect(()=>{let live=true;(async()=>{try{const [d,p,i]=await Promise.all([billingJson('/api/billing'),billingJson('/api/billing/details'),billingJson('/api/billing/invoices')]);if(live){setData(d);setInvoices(i.invoices);if(p.details){setDetails(p.details);setSaved(true);}}}catch(e){if(live)setError((e as Error).message);}})();return()=>{live=false;};},[]);
 async function save(){setBusy(true);setError('');try{await billingJson('/api/billing/details',details,'PUT');setSaved(true);setNotice('Billing details saved.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function buy(kind:'pack'|'plan',id:string){setBusy(true);setError('');setNotice('');try{
  await loadCheckout();
  const purchase=await billingJson(kind==='pack'?'/api/billing/order':'/api/billing/subscribe',kind==='pack'?{pack:Number(id)}:{plan:id,period:annual?'annual':'monthly'});
  const result=await openCheckout({key:purchase.keyId,name:'Forme',description:kind==='pack'?`${purchase.credits} AI credits`:`${id} subscription`,...(kind==='pack'?{order_id:purchase.orderId,amount:purchase.amount,currency:'INR'}:{subscription_id:purchase.subscriptionId}),prefill:{name:details.name,email:details.billingEmail}});
  if(!result){setNotice('Checkout closed. No new purchase was started automatically. Refresh Billing to check payment status.');return;}
  if(kind==='pack'){
   await billingJson('/api/billing/verify',{orderId:purchase.orderId,paymentId:result.razorpay_payment_id,signature:result.razorpay_signature});setNotice('Payment verified. Credits added and invoice available.');
  }else setNotice('Checkout completed. Subscription status and credits update after Razorpay confirms the payment. Refresh Billing to check.');
  await refresh();
 }catch(e){setError((e as Error).message+' Check Billing before paying again.');}finally{setBusy(false);}}
 const handleDownload=async(i:Invoice)=>{setBusy(true);setError('');try{await billingDownload(`/api/billing/invoices/${i.id}`,i.number.replace('/','-')+'.pdf');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <main className="billing-page"><nav><a href="/">Back to Forme</a> <a href="/usage">Usage</a></nav><h1>Billing</h1>
 {error&&<p role="alert" className="error-banner">{error}</p>}{notice&&<p role="status" className="billing-notice">{notice}</p>}
 {!data&&!error?<p role="status">Loading credits…</p>:data&&<>
  <section className="billing-summary"><p>Plan: <strong>{data.plan}</strong> · {data.status}</p><h2>{data.balances.ai} AI credits available</h2><p>{data.balances.photo} catalogue photo credits</p>
   {data.status==='trial'?<p>Trial ends: {date(data.trialEndsAt)}. Subscribe to continue after it ends; credit packs do not extend the trial.</p>:<p>Current paid period ends: {date(data.subscription?.currentPeriodEnd||null)}</p>}
   <p>Only delivered AI images use credits. Saved avatars and approved adaptation reuse are free.</p>
   <button className="button secondary" disabled={busy} onClick={()=>{setError('');void refresh().catch(e=>setError(e.message));}}>Refresh billing</button>
  </section>
  <section><h2>Invoice details</h2><form className="billing-details" onSubmit={e=>{e.preventDefault();void save();}}>
   {([['name','Legal / business name'],['address','Billing address'],['billingEmail','Billing email'],['stateCode','Indian state code (2 digits)'],['gstin','GSTIN (optional)']] as const).map(([key,label])=><label key={key}>{label}<input type={key==='billingEmail'?'email':'text'} required={key!=='gstin'} maxLength={key==='stateCode'?2:key==='gstin'?15:key==='address'?500:120} value={details[key]} disabled={busy} onChange={e=>{setDetails({...details,[key]:e.target.value});setSaved(false);}}/></label>)}
   <button className="button primary" disabled={busy}>Save billing details</button>
  </form></section>
  {data.status==='suspended'&&<p role="alert">This organisation is suspended. Contact your administrator before purchasing.</p>}
  {!data.paymentsAvailable&&<p role="status">Online payments are not configured. Contact your Forme administrator.</p>}
  {!saved&&<p>Save invoice details before opening checkout.</p>}
  <section><h2>Plans</h2><label className="consent"><input type="checkbox" checked={annual} disabled={busy} onChange={e=>setAnnual(e.target.checked)}/>Annual billing — pay for 10 months, receive 12 months of credits upfront</label>
   <p>Prices include 18% GST. Subscriptions renew through Razorpay.</p>
   <div className="billing-cards">{data.plans?.map(p=><article key={p.id}><h3>{p.id}</h3><strong>{money(annual?p.annual:p.monthly)} / {annual?'year':'month'}</strong><p>{p.credits*(annual?12:1)} AI credits per billing period</p><button className="button primary" disabled={busy||!saved||!data.paymentsAvailable||data.status==='suspended'||!(annual?p.annualAvailable:p.monthlyAvailable)||Boolean(data.subscription&&!['cancelled','completed','expired'].includes(data.subscription.status))} onClick={()=>void buy('plan',p.id)}>Subscribe to {p.id}</button></article>)}</div>
   {data.subscription&&<p>Subscription: {data.subscription.status}. Contact your administrator to change or cancel an existing subscription.</p>}
  </section>
  <section><h2>Credit packs</h2><p>One-time purchases; prices include 18% GST.</p><div className="billing-cards">{data.packs?.map(p=><article key={p.id}><h3>{p.credits} AI credits</h3><p>{money(p.amount)}</p><button className="button secondary" disabled={busy||!saved||!data.paymentsAvailable||data.status==='suspended'} onClick={()=>void buy('pack',p.id)}>Buy {p.credits} credits</button></article>)}</div></section>
  <section><h2>Invoices</h2>{invoices.length===0?<p>No invoices yet.</p>:<ul className="billing-invoices">{invoices.map(i=><li key={i.id}><span>{i.number} · {date(i.createdAt)} · {i.emailedAt?'Emailed':'Email pending'}</span><button className="button secondary" disabled={busy} onClick={()=>void handleDownload(i)}>Download {i.number}</button></li>)}</ul>}</section>
 </>}
 </main>;
}
