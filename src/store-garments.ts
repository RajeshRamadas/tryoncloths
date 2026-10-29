import { requestApi } from './api';
import type { GarmentType } from './garment-types';

export type StoreGarment = { id:string; name:string; garmentType:GarmentType; variant:string; sourceUrl:string; thumbnail:string; adaptations:number; savedAt:number; image?:string };
export type GarmentMatches = { exact:StoreGarment[]; linked:StoreGarment[]; similar:StoreGarment[] };
export type Adaptation = { garmentId?:string; reuseReceipt?:string; reused?:boolean; reuseWarning?:string };
export async function catalogueRequest(path:string, body?:unknown, method=body === undefined ? 'GET' : 'POST') {
  const response = await requestApi(path, { method, ...(body === undefined ? {} : { headers:{'Content-Type':'application/json'},body:JSON.stringify(body) }) }, 30000);
  const data = await response.json();
  if (response.status === 401) window.dispatchEvent(new Event('forme-account-expired'));
  if (!response.ok) throw new Error(data.error || 'The store catalogue could not be opened.');
  return data;
}
export const listGarments = async ():Promise<StoreGarment[]> => (await catalogueRequest('/api/garments')).garments;
export const getGarment = async (id:string):Promise<StoreGarment> => (await catalogueRequest(`/api/garments/${encodeURIComponent(id)}`)).garment;
export const matchGarments = (input:{url?:string;image?:string}):Promise<GarmentMatches> => catalogueRequest('/api/garments/match',input);
export const deleteGarment = (id:string) => catalogueRequest(`/api/garments/${encodeURIComponent(id)}`,undefined,'DELETE');
export const saveGarment = (input:{name:string;garmentType:GarmentType;variant:string;sourceUrl:string;image:string}):Promise<{garment:StoreGarment;duplicate:boolean}> => catalogueRequest('/api/garments',{...input,storageConsent:true});
export const findAdaptation = (id:string,input:{avatar:string;avatarId:string;garmentType:GarmentType;bodyType:string}):Promise<{match:boolean;id?:string;image?:string}> => catalogueRequest(`/api/garments/${encodeURIComponent(id)}/reuse`,input);
export const saveAdaptation = (id:string,image:string,receipt:string) => catalogueRequest(`/api/garments/${encodeURIComponent(id)}/results`,{image,receipt,reviewed:true,storageConsent:true});
export const deleteAdaptation = (id:string,result:string) => catalogueRequest(`/api/garments/${encodeURIComponent(id)}/results/${encodeURIComponent(result)}`,undefined,'DELETE');
