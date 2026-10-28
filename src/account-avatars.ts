import { requestApi } from "./api";
import { type AvatarDetails, type SavedAvatar } from "./saved-avatars";
async function json(path:string,init?:RequestInit){const response=await requestApi(path,init,30000);const data=await response.json();if(response.status===401)window.dispatchEvent(new Event("forme-account-expired"));if(!response.ok)throw new Error(data.error||"Account request failed.");return data;}
export async function listAccountAvatars():Promise<SavedAvatar[]>{
  const data=await json("/api/avatars");
  return data.avatars.map((a:SavedAvatar)=>({...a,image:new Blob([],{type:"image/png"})}));
}
export async function accountAvatarImage(id:string):Promise<Blob>{const r=await requestApi(`/api/avatars/${encodeURIComponent(id)}/image`,{},30000);if(r.status===401)window.dispatchEvent(new Event("forme-account-expired"));if(!r.ok)throw new Error("This avatar could not be opened. Sign in again and retry.");return r.blob();}
export async function saveAccountAvatar(image:string,details:AvatarDetails){await json("/api/avatars",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...details,image,storageConsent:true})});}
export async function deleteAccountAvatar(id:string){await json(`/api/avatars/${encodeURIComponent(id)}`,{method:"DELETE"});}
