import {requestApi} from './api';
export type ProductPhoto={source:string;image:string};
export async function readProductPhotos(url:string,signal?:AbortSignal):Promise<{title:string;url:string;images:ProductPhoto[]}>{
  const response=await requestApi('/api/product-link',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({url:url.trim()})},45000),data=await response.json();
  if(response.status===401)window.dispatchEvent(new Event('forme-account-expired'));
  if(!response.ok)throw new Error(data.error||'The product link could not be read.');
  const images=(Array.isArray(data.images)?data.images:[]).filter((p:ProductPhoto)=>typeof p?.image==='string'&&p.image.startsWith('data:image/jpeg;base64,'));
  if(!images.length)throw new Error('No product images were found. Upload the product image instead.');
  return {title:typeof data.title==='string'?data.title:'',url:typeof data.url==='string'?data.url:url.trim(),images};
}
