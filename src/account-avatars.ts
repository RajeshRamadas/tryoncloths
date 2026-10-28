import { requestApi } from "./api";
import { type AvatarDetails, type SavedAvatar } from "./saved-avatars";
async function json(path:string,init?:RequestInit){const response=await requestApi(path,init,30000);const data=await response.json();if(response.status===401)window.dispatchEvent(new Event("forme-account-expired"));if(!response.ok)throw new Error(data.error||"Account request failed.");return data;}
export async function listAccountAvatars():Promise<SavedAvatar[]>{
  const data=await json("/api/avatars");
  return data.avatars.map((a:SavedAvatar)=>({...a,image:new Blob([],{type:"image/png"})}));
}
export async function accountAvatarImage(id:string):Promise<Blob>{const r=await requestApi(`/api/avatars/${encodeURIComponent(id)}/image`,{},30000);if(r.status===401)window.dispatchEvent(new Event("forme-account-expired"));if(!r.ok)throw new Error("This avatar could not be opened. Sign in again and retry.");return r.blob();}
export async function saveAccountAvatar(image:string,details:AvatarDetails){return json("/api/avatars",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...details,image,storageConsent:true})});}
export async function deleteAccountAvatar(id:string){await json(`/api/avatars/${encodeURIComponent(id)}`,{method:"DELETE"});}

export type SavedLook = { id:string; avatarId:string; name:string; garments:string[]; thumbnail:string; savedAt:number };
export async function listLooks(avatarId:string):Promise<SavedLook[]> { return (await json(`/api/looks?avatar=${encodeURIComponent(avatarId)}`)).looks; }
export async function saveLook(image:string,avatarId:string,name:string,garments:string[]) { return json("/api/looks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image,avatarId,name,garments,storageConsent:true})}); }
export async function deleteLook(id:string) { await json(`/api/looks/${encodeURIComponent(id)}`,{method:"DELETE"}); }
export async function lookImage(id:string):Promise<Blob> { const r=await requestApi(`/api/looks/${encodeURIComponent(id)}/image`,{},30000);if(r.status===401)window.dispatchEvent(new Event("forme-account-expired"));if(!r.ok)throw new Error("The saved look could not be opened.");return r.blob(); }
