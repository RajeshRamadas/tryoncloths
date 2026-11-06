import {requestApi} from './api';
export type CustomerRef = {id:string; name:string; phoneE164:string};
export type Customer = CustomerRef & {notes:string; marketingOptIn:boolean; optInAt:number|null; optInSource:'in_store'|'whatsapp'|null; measurements:{heightCm:number;weightKg:number}|null; createdAt:number};
export async function customerRequest(path:string,method='GET',body?:unknown) {
  const response=await requestApi(`/api/customers${path}`,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})},30000);
  const data=await response.json();
  if(response.status===401)window.dispatchEvent(new Event('forme-account-expired'));
  if(!response.ok)throw new Error(data.error||'Customer details could not be saved.');
  return data;
}
