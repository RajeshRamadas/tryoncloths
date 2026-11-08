import {previewLabel} from './jewellery-overlay';
import {requestApi} from './api';
import {loadImage} from './images';
import type {JewelleryType,JewelleryAttributes} from './jewellery-types';
export type PreviewMode='ai'|'overlay'|'mixed';
export type View='portrait'|'hands'|'full';
export type JewelleryItem={id:string;name:string;garmentType:JewelleryType;attributes:JewelleryAttributes;thumbnail:string;image?:string;variant:string;sourceUrl:string;priceInr:number|null;stock:string;hasOverlay?:boolean;overlayPng?:string;overlayAnchor?:string};
export type Piece={itemId:string|null;name:string;type:JewelleryType;attributes:JewelleryAttributes;side?:string;finger?:string;hand?:string;wrist?:string;replaceExisting?:string|false;resultId?:string;mode?:'ai'|'overlay'};
export type JewelleryResult={image:string;receipt?:string;resultId:string;reused:boolean;view:View;creditsUsed:number;receiptUnavailable?:boolean;kind?:string;previewMode?:PreviewMode};
export const regions:Record<JewelleryType,string>={stud_earrings:'ears',drop_earrings:'ears',jhumka:'ears',nose_pin:'nose',nose_ring:'nose',maang_tikka:'forehead',matha_patti:'forehead',choker:'neck',necklace:'neck',pendant:'neck',mangalsutra:'neck',long_haar:'neck',ring:'finger',bangles:'wrist',bracelet:'wrist',watch:'wrist',waist_belt:'waist',anklets:'ankles'};
export async function jewelleryApi(path:string,body?:unknown,signal?:AbortSignal,timeout=30000){
  const response=await requestApi(path,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal},timeout),data=await response.json();
  if(response.status===401)window.dispatchEvent(new Event('forme-account-expired'));
  if(!response.ok)throw new Error(data.error||'The jewellery request failed. No automatic retry was made.');return data;
}
export async function imageData(path:string,signal?:AbortSignal){const r=await requestApi(path,{signal},30000);if(r.status===401)window.dispatchEvent(new Event('forme-account-expired'));if(!r.ok)throw new Error('The approved image could not be opened. Refresh the saved views.');return blobData(await r.blob());}
export const blobData=(blob:Blob)=>new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(new Error('The image could not be opened.'));r.readAsDataURL(blob);});
export function scaleNote(a:JewelleryAttributes){return [a.lengthCm?`${a.lengthCm} cm chain · ${a.lengthCm<=42?'choker':a.lengthCm<=50?'princess':a.lengthCm<=65?'matinee':'long'} length`:'',a.dropMm?`${a.dropMm} mm drop`:'',a.pendantMm?`${a.pendantMm} mm pendant`:'',a.ringSizeIn?`Indian ring size ${a.ringSizeIn}`:'',a.bangleSize?`Bangle size ${a.bangleSize}`:'',a.count?`${a.count} pieces per selected wrist`:''].filter(Boolean).join(' · ')||'Approximate scale from visible anatomy; product dimensions not provided.';}
export async function downloadJewellery(image:string,view:View,signal?:AbortSignal,active:()=>boolean=()=>true,mode:PreviewMode='ai'){
  const source=await loadImage(image),canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height+52;
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0);ctx.fillStyle='#294b3c';ctx.font=`${Math.min(20,canvas.width/28)}px sans-serif`;ctx.textAlign='center';ctx.fillText(previewLabel(mode),canvas.width/2,source.height+32);
  signal?.throwIfAborted();if(!active())throw new DOMException('The studio session changed.','AbortError');
  const response=await requestApi('/api/exports/image',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({image:canvas.toDataURL('image/png')})},30000);
  if(response.status===401)window.dispatchEvent(new Event('forme-account-expired'));
  if(!response.ok)throw new Error('The jewellery export could not be prepared.');
  const blob=await response.blob();signal?.throwIfAborted();if(!active())throw new DOMException('The studio session changed.','AbortError');
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`forme-jewellery-${view}-avatar.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;
}
