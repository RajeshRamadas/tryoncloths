import { useRef, useState } from "react";
import { Link2, Search, Sparkles, Upload } from "lucide-react";
import { requestApi } from "./api";
import { readPhoto } from "./images";

export const garmentChoices = [
  ["dress","Dress"], ["skirt","Skirt"], ["saree","Saree"], ["lehenga","Lehenga"], ["blouse","Blouse"],
  ["shirt", "Shirt"], ["tshirt", "T-shirt"], ["top", "Top"], ["jacket", "Jacket"], ["kurta", "Kurta"],
  ["trousers", "Trousers"], ["jeans", "Jeans"], ["shorts", "Shorts"], ["shoes", "Shoes"], ["outfit", "Full outfit"],
] as const;
export type GarmentType = (typeof garmentChoices)[number][0];
type ProductImage = { source: string; image: string };

/** Best guess from the product name; staff always confirm before generating. */
export function guessGarmentType(title: string): GarmentType | null {
  const t = title.toLowerCase();
  if (/saree|sari/.test(title.toLowerCase())) return "saree";
  if (/lehenga/.test(title.toLowerCase())) return "lehenga";
  if (/blouse/.test(title.toLowerCase())) return "blouse";
  if (/\bdress\b(?!\s+(shirt|shoes|pants|trousers))/.test(t)) return "dress";
  if (/skirt/.test(title.toLowerCase())) return "skirt";
  if (/\b(jeans|denim pant)/.test(t)) return "jeans";
  if (/\b(t-?shirts?|tees?|polo)\b/.test(t)) return "tshirt";
  if (/\bkurta/.test(t)) return "kurta";
  if (/\b(jacket|blazer|hoodie|sweatshirt|coat|overshirt)\b/.test(t)) return "jacket";
  if (/\bshorts\b/.test(t)) return "shorts";
  if (/\b(trousers?|pants?|chinos?|joggers?|track ?pants?|cargos?)\b/.test(t)) return "trousers";
  if (/\b(shoes?|sneakers?|loafers?|boots?|sandals?|slippers?|footwear)\b/.test(t)) return "shoes";
  if (/\bshirts?\b/.test(t)) return "shirt";
  if (/\b(set|co-?ord|suit|outfit)\b/.test(t)) return "outfit";
  return null;
}

type Props = {
  bodyType?: "male" | "female";
  base: string;
  disabled: boolean;
  available: boolean;
  providerLabel: string;
  onBusy: (busy: boolean) => void;
  onResult: (image: string, label: string) => void;
};

export default function LinkTryOn({ bodyType = "male", base, disabled, available, providerLabel, onBusy, onResult }: Props) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [images, setImages] = useState<ProductImage[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [garmentType, setGarmentType] = useState<GarmentType | null>(null);
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<"idle" | "reading" | "generating">("idle");
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const busy = state !== "idle" || disabled;

  function begin(next: "reading" | "generating") { setState(next); onBusy(true); setError(""); }
  function finish() { setState("idle"); onBusy(false); }
  function accountExpired(code?: string) { if (code === "account_required") window.dispatchEvent(new Event("forme-account-expired")); }
  function applyProduct(nextTitle: string, nextImages: ProductImage[]) {
    setTitle(nextTitle); setImages(nextImages); setChosen(nextImages[0]?.image ?? null);
    const guess=guessGarmentType(nextTitle); setGarmentType(bodyType === "male" && ["dress","skirt","saree","lehenga","blouse"].includes(guess || "") ? null : guess); setConsent(false);
  }

  async function findProduct() {
    if (!url.trim() || busy) return;
    begin("reading");
    try {
      const response = await requestApi("/api/product-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim() }) }, 45000);
      const data = await response.json();
      accountExpired(data.code);
      if (!response.ok) throw new Error(data.error || "The product link could not be read.");
      const valid = (Array.isArray(data.images) ? data.images : []).filter((item: ProductImage) => typeof item?.image === "string" && item.image.startsWith("data:image/jpeg;base64,"));
      if (!valid.length) throw new Error("No product images were found. Upload the product image instead.");
      applyProduct(typeof data.title === "string" ? data.title : "", valid);
    } catch (e) {
      setError(e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "The website took too long to respond. Try again or upload the product image." : (e as Error).message);
    } finally { finish(); }
  }

  async function uploadProduct(selected?: File) {
    if (!selected || busy) return;
    setError("");
    try {
      const image = await readPhoto(selected);
      applyProduct(selected.name.replace(/\.[^.]+$/, "").slice(0, 100), [{ source: "upload", image }]);
    } catch (e) { setError((e as Error).message); }
  }

  async function putOn() {
    if (!chosen || !garmentType || !consent || !base || busy || !available) return;
    begin("generating");
    setConsent(false);
    try {
      const response = await requestApi("/api/tryon", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: base, bodyType, garment: chosen, garmentType, title, consent: true, consentScope: "avatar-and-garment", consentProvider: "gemini" }),
      }, 200000);
      const data = await response.json();
      accountExpired(data.code);
      if (!response.ok) throw new Error(data.error || "Clothing try-on failed. The avatar is unchanged.");
      if (data.kind !== "garment-tryon" || typeof data.image !== "string" || !data.image.startsWith("data:image/png;base64,"))
        throw new Error("The studio returned an unsupported result. Update the studio and try again.");
      const label = garmentChoices.find(([id]) => id === garmentType)?.[1] ?? "Garment";
      onResult(data.image, title ? `${label} · ${title}` : label);
      setConsent(false);
    } catch (e) {
      setError(e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "The request timed out. The provider may still have processed it; check before retrying." : (e as Error).message);
    } finally { finish(); }
  }

  return <section className="outfit-panel link-tryon" aria-label="Try clothes from a product link">
    <h2><Link2 size={20}/> From any clothing website</h2>
    <p>Paste a product link. The studio finds the product photos; choose the photo and what to put on the avatar.</p>
    {!available && <p className="small-footnote" role="note">Product-link try-on needs the Gemini provider configured on the studio. Sample layers below still work.</p>}
    <div className="link-row">
      <input type="url" inputMode="url" placeholder="https://www.example.com/men-shirt/123" aria-label="Product link" value={url} disabled={busy}
        onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void findProduct(); }}/>
      <button className="button secondary" disabled={busy || !url.trim()} onClick={() => void findProduct()}><Search size={16}/>{state === "reading" ? "Reading…" : "Find"}</button>
    </div>
    <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="outfit-file" aria-label="Upload product photo" disabled={busy}
      onChange={e => { void uploadProduct(e.target.files?.[0]); e.target.value = ""; }}/>
    <button className="button back-button full-width" disabled={busy} onClick={() => file.current?.click()}><Upload size={16}/> Or upload a product photo / screenshot</button>

    {images.length > 0 && <>
      {title && <p className="product-title"><strong>{title}</strong></p>}
      <div className="product-images" role="group" aria-label="Product photos">
        {images.map((item, index) => <button key={item.image.slice(-40) + index} className="garment-tile" disabled={busy} aria-pressed={chosen === item.image} onClick={() => { setChosen(item.image); setConsent(false); }}>
          <img src={item.image} alt={`Product photo ${index + 1}`}/></button>)}
      </div>
      <h3 className="link-question">What should the avatar wear from this?</h3>
      <div className="garment-chips" role="group" aria-label="Garment type">
        {garmentChoices.filter(([id])=>bodyType === "female" || !["dress","skirt","saree","lehenga","blouse"].includes(id)).map(([id, label]) => <button key={id} disabled={busy} aria-pressed={garmentType === id} onClick={() => { setGarmentType(id); setConsent(false); }}>{label}</button>)}
      </div>
      <label className="consent"><input type="checkbox" checked={consent} disabled={busy || !available} onChange={e => setConsent(e.target.checked)}/>
        <span>The customer agrees to send their avatar and this product photo to {providerLabel} to create the try-on.</span></label>
      <button className="button primary full-width" disabled={busy || !available || !consent || !chosen || !garmentType || !base} onClick={() => void putOn()}>
        <Sparkles size={17}/>{state === "generating" ? "Dressing the avatar…" : "Put on avatar"}</button>
      <p className="small-footnote">One AI request per garment; a provider charge may apply. Add the next item after this one to build a full outfit. Results are approximate and need review.</p>
    </>}
    {error && <p role="alert" className="error-banner">{error}</p>}
  </section>;
}
