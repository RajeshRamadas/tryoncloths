import { useRef, useState } from "react";
import { FolderOpen, X } from "lucide-react";
import { avatarDataUrl, deleteAvatar, listAvatars, readAvatarPng, type AvatarDetails, type SavedAvatar } from "./saved-avatars";
import { listAccountAvatars, accountAvatarImage, deleteAccountAvatar, listLooks, lookImage, deleteLook, type SavedLook } from "./account-avatars";
import { profiles, recommendProfile } from "./profiles";

type Props = { disabled: boolean; cloud?: boolean; onUse: (image: string, details: AvatarDetails) => void };
export default function SavedAvatars({ disabled, cloud = false, onUse }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [items, setItems] = useState<SavedAvatar[]>([]);
  const [looksFor,setLooksFor]=useState<SavedAvatar|null>(null);
  const [looks,setLooks]=useState<SavedLook[]>([]);
  const [confirmLookDelete,setConfirmLookDelete]=useState<string|null>(null);
  const [localView,setLocalView] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [profileId, setProfileId] = useState("regular");
  const [height, setHeight] = useState("175");
  const [weight, setWeight] = useState("72");
  async function show() {
    dialog.current?.showModal(); setLooksFor(null); setLooks([]); setLocalView(false); setItems([]); setBusy(true); setError(""); setConfirmDelete(null);
    try { setItems(await (cloud ? listAccountAvatars() : listAvatars())); } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function close() { dialog.current?.close(); trigger.current?.focus(); }
  async function use(item: SavedAvatar) {
    setBusy(true); setError("");
    try { const image = await avatarDataUrl(cloud && !localView ? await accountAvatarImage(item.id) : item.image); close(); onUse(image,{...item,avatarId:cloud&&!localView?item.id:undefined}); }
    catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); setError("");
    try { await (cloud && !localView ? deleteAccountAvatar(id) : deleteAvatar(id)); setItems(await (cloud && !localView ? listAccountAvatars() : listAvatars())); setConfirmDelete(null); if(looksFor?.id===id)setLooksFor(null); }
    catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function showLooks(item:SavedAvatar) {
    setBusy(true);setError("");setConfirmLookDelete(null);
    try {setLooks(await listLooks(item.id));setLooksFor(item);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function useLook(look:SavedLook) {
    if(!looksFor)return;setBusy(true);setError("");
    try {
      const [avatar,image]=await Promise.all([accountAvatarImage(looksFor.id).then(avatarDataUrl),lookImage(look.id).then(avatarDataUrl)]);
      close();onUse(avatar,{...looksFor,avatarId:looksFor.id,look:{image,name:look.name,garments:look.garments}});
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function removeLook(id:string) {
    if(!looksFor)return;setBusy(true);setError("");
    try{await deleteLook(id);setLooks(await listLooks(looksFor.id));setItems(await listAccountAvatars());setConfirmLookDelete(null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function importPng(file?: File) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const image = await readAvatarPng(file);
      close(); onUse(image, { name: file.name.replace(/\.png$/i, "").slice(0,60), profileId, heightCm:Number(height), weightKg:Number(weight), source:"imported" });
    } catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <button ref={trigger} className="button secondary" disabled={disabled} onClick={() => void show()}><FolderOpen size={17}/> Saved avatars</button>
    <dialog ref={dialog} className="saved-avatars-dialog" aria-labelledby="saved-avatar-heading" onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
      <header className="saved-avatars-heading"><h2 id="saved-avatar-heading">Saved avatars</h2><button className="icon-button" aria-label="Close saved avatars" disabled={busy} onClick={close}><X size={20}/></button></header>
      <p>{cloud && !localView ? "Avatars saved to your signed-in store account. Reopen them on any browser using the same account." : "Reuse an avatar without generating again. Saved here on this browser or app only; anyone using it can open these avatars."}</p>
      {cloud && <button className="button secondary" disabled={busy} onClick={async()=>{setBusy(true);setError("");setConfirmDelete(null);setLooksFor(null);try{setItems(await (localView ? listAccountAvatars() : listAvatars()));setLocalView(!localView);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{localView ? "Back to account avatars" : "Open this device’s older library"}</button>}
      {cloud && localView && <p>These older local copies have not been uploaded. Open one, review it and choose Save avatar for reuse to copy it to your store account.</p>}
      {busy && <p role="status">Opening library…</p>}
      {!busy && !items.length && <p>No saved avatars yet. Approve an avatar and choose “Save avatar for reuse”, or open a downloaded PNG below.</p>}
      <div className="saved-avatar-list">{items.map(item => <article className="saved-avatar-item" key={item.id}>
        <img src={item.thumbnail} alt={`Saved avatar: ${item.name}`}/><div><h3>{item.name}</h3><p>{profiles.find(p => p.id === item.profileId)?.name} · {item.heightCm} cm · {item.weightKg} kg<br/>{new Date(item.savedAt).toLocaleDateString()}</p>
        <button className="button primary" disabled={busy} onClick={() => void use(item)}>Use {item.name}</button>
        {cloud && !localView && <button className="button secondary" disabled={busy} onClick={()=>void showLooks(item)}>View looks ({item.looksCount || 0}) for {item.name}</button>}
        {confirmDelete === item.id ? <div className="saved-delete"><p>Delete this saved copy{cloud && !localView ? " and its saved looks" : ""}?</p><button className="button secondary" disabled={busy} onClick={() => void remove(item.id)}>Confirm deletion</button><button className="button back-button" disabled={busy} onClick={() => setConfirmDelete(null)}>Cancel deletion</button></div>
          : <button className="button back-button" disabled={busy} aria-label={`Delete ${item.name}`} onClick={() => setConfirmDelete(item.id)}>Delete</button>}</div>
      </article>)}</div>
      {cloud && !localView && looksFor && <section aria-label={`Looks for ${looksFor.name}`}><h3>Looks for {looksFor.name}</h3>
        {!looks.length && <p>No looks saved for this avatar yet.</p>}
        {looks.map(look=><article className="saved-avatar-item" key={look.id}><img src={look.thumbnail} alt={`Saved look: ${look.name}`}/><div><h3>{look.name}</h3><p>{look.garments.join(" · ")}</p>
          <button className="button primary" disabled={busy} onClick={()=>void useLook(look)}>Open look {look.name}</button>
          {confirmLookDelete===look.id ? <><button className="button secondary" disabled={busy} onClick={()=>void removeLook(look.id)}>Confirm look deletion</button><button className="button back-button" disabled={busy} onClick={()=>setConfirmLookDelete(null)}>Cancel</button></> : <button className="button back-button" disabled={busy} onClick={()=>setConfirmLookDelete(look.id)}>Delete look {look.name}</button>}
        </div></article>)}
      </section>}
      <details className="avatar-import"><summary>Open a downloaded avatar PNG</summary><p>Choose the body profile and approximate measurements used for this full-body avatar. Importing makes no AI request and opens it for review.</p>
        <label>Avatar body profile<select value={profileId} disabled={busy} onChange={e => setProfileId(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <div className="measurement-grid"><label>Saved height (cm)<input type="number" min="140" max="210" value={height} disabled={busy} onChange={e => setHeight(e.target.value)}/></label><label>Saved weight (kg)<input type="number" min="35" max="200" value={weight} disabled={busy} onChange={e => setWeight(e.target.value)}/></label></div>
        <label>Open avatar PNG<input type="file" accept="image/png" disabled={busy || !recommendProfile(Number(height), Number(weight))} onChange={e => { void importPng(e.target.files?.[0]); e.target.value = ""; }}/></label>
      </details>
      {error && <p role="alert" className="error-banner">{error}</p>}
      <p className="small-footnote">{cloud && !localView ? "Original customer photos are not stored. Signing out clears the active session but keeps account avatars. Deleting here removes the saved account copy, not downloaded PNGs." : "Original customer photos are never saved here. Clearing site/app data or uninstalling removes this local library. Keep a downloaded PNG as a backup."}</p>
    </dialog>
  </>;
}
