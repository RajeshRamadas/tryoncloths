import { loadImage } from "./images";
import { profiles, recommendProfile } from "./profiles";

export type AvatarDetails = { name: string; profileId: string; heightCm: number; weightKg: number; source: "generated" | "imported" };
export type SavedAvatar = AvatarDetails & { id: string; image: Blob; thumbnail: string; savedAt: number };
const database = "forme-saved-avatars";
const storeName = "avatars";
const storageError = () => new Error("Could not access saved avatars. Allow site storage or free some space, then try again. You can still download the PNG as a backup.");

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(database, 1); } catch { reject(storageError()); return; }
    request.onupgradeneeded = () => { request.result.createObjectStore(storeName, { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError());
    request.onblocked = () => reject(storageError());
  });
}
function validDetails(details: AvatarDetails) {
  return typeof details?.name === "string" && details.name.trim().length > 0 && details.name.length <= 60 && profiles.some(p => p.id === details.profileId)
    && recommendProfile(details.heightCm, details.weightKg) && ["generated", "imported"].includes(details.source);
}
export async function listAvatars(): Promise<SavedAvatar[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();
    tx.oncomplete = () => { db.close(); resolve((request.result as SavedAvatar[]).filter(a => validDetails(a) && a.image instanceof Blob && a.image.type === "image/png").sort((a,b) => b.savedAt-a.savedAt)); };
    tx.onabort = tx.onerror = () => { db.close(); reject(storageError()); };
  });
}
export async function saveAvatar(image: string, details: AvatarDetails): Promise<void> {
  if (!validDetails(details) || !image.startsWith("data:image/png;base64,")) throw new Error("Choose a name and valid avatar details before saving.");
  const blob = await (await fetch(image)).blob();
  if (blob.size > 15 * 1024 * 1024) throw new Error("This avatar is too large to save locally. Download the PNG instead.");
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const id = [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2,"0")).join("");
  const img = await loadImage(image);
  const thumb = document.createElement("canvas");
  thumb.height = 160; thumb.width = Math.max(1, Math.round(img.width / img.height * 160));
  thumb.getContext("2d")!.drawImage(img,0,0,thumb.width,thumb.height);
  // Whitelist metadata; original customer photos, provider keys and tokens must
  // never enter this database. Identical PNGs update rather than duplicate.
  const record: SavedAvatar = { id, name: details.name.trim(), profileId: details.profileId, heightCm: details.heightCm, weightKg: details.weightKg, source: details.source, image: blob, thumbnail: thumb.toDataURL("image/png"), savedAt: Date.now() };
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    let full = false;
    const existing = store.get(id);
    existing.onsuccess = () => {
      const count = store.count();
      count.onsuccess = () => {
        if (!existing.result && count.result >= 20) { full = true; tx.abort(); return; }
        store.put(record);
      };
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(full ? new Error("The library holds up to 20 avatars. Delete one before saving another.") : storageError()); };
  });
}
export async function deleteAvatar(id: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(storageError()); };
  });
}
export function avatarDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("This saved avatar could not be opened."));
    reader.readAsDataURL(blob);
  });
}
export async function readAvatarPng(file: File): Promise<string> {
  if (file.type !== "image/png" || file.size > 15 * 1024 * 1024) throw new Error("Choose a downloaded avatar PNG under 15 MB.");
  const data = await avatarDataUrl(file);
  const image = await loadImage(data);
  if (image.width < 128 || image.height < 256 || image.width * image.height > 16_000_000 || image.width >= image.height)
    throw new Error("Use a portrait, full-body avatar PNG, at least 128 × 256 pixels and at most 16 megapixels.");
  return data;
}
