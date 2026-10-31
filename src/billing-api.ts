import {requestApi} from './api';
export async function billingJson(path:string,body?:unknown,method=body?'POST':'GET'){
 const r=await requestApi(path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})},25000);
 const data=await r.json();if(!r.ok)throw new Error(r.status===403?'Only a store owner can view billing or make purchases.':data.error||'Billing could not be loaded.');return data;
}
export async function billingDownload(path:string,filename:string){
 const r=await requestApi(path,{},30000);if(!r.ok)throw new Error('Download unavailable. Check your store access.');
 const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
type CheckoutInstance={open:()=>void;on:(event:string,handler:(value:unknown)=>void)=>void};
declare global{interface Window{Razorpay?:new(options:Record<string,unknown>)=>CheckoutInstance;}}
let loading:Promise<void>|undefined;
export function loadCheckout(){
 if(window.Razorpay)return Promise.resolve();
 if(!loading)loading=new Promise<void>((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://checkout.razorpay.com/v1/checkout.js';script.async=true;
  const fail=()=>{clearTimeout(timer);script.remove();loading=undefined;reject(new Error('Checkout could not load. Check your connection; no payment was started.'));};
  const timer=setTimeout(fail,15000);script.onerror=fail;script.onload=()=>{clearTimeout(timer);if(window.Razorpay)resolve();else fail();};document.head.appendChild(script);
 });return loading;
}
export function openCheckout(options:Record<string,unknown>):Promise<Record<string,string>|null>{
 return new Promise((resolve,reject)=>{try{
  const checkout=new window.Razorpay!({...options,handler:(result:Record<string,string>)=>resolve(result),modal:{ondismiss:()=>resolve(null)}});checkout.open();
 }catch{reject(new Error('Checkout could not open. Check Billing before starting another purchase.'));}});
}
