import {useEffect,useState} from 'react';
import {requestApi} from './api';
export default function CreditBadge({accountId}:{accountId:string}){
 const [balance,setBalance]=useState<{remaining:number;low:boolean}|null>(null);
 useEffect(()=>{let live=true;const refresh=()=>{void requestApi('/api/credits').then(async r=>{if(r.ok){const value=await r.json();if(live)setBalance(value);}else if(live)setBalance(null);}).catch(()=>{});};refresh();window.addEventListener('forme-credits-changed',refresh);window.addEventListener('focus',refresh);return()=>{live=false;window.removeEventListener('forme-credits-changed',refresh);window.removeEventListener('focus',refresh);};},[accountId]);
 return balance&&<span className={`credit-badge ${balance.low?'low':''}`} role="status">{balance.remaining} AI credits{balance.low?' · Low balance':''}</span>;
}
