import {CreditHelp} from "./Billing";
import { useEffect, useRef, useState } from "react";
import { Link2, Search, Sparkles, Upload } from "lucide-react";
import { requestApi } from "./api";
import { readPhoto } from "./images";

import { garmentChoices, guessGarmentType, type GarmentType } from "./garment-types";
import GarmentCatalogue, { MatchSuggestions } from "./GarmentCatalogue";
import { getGarment, matchGarments, saveGarment, findAdaptation, deleteAdaptation, type StoreGarment, type GarmentMatches, type Adaptation } from "./store-garments";

type ProductImage = { source: string; image: string };
const emptyMatches = ():GarmentMatches => ({exact:[],linked:[],similar:[]});

type Props = {
  catalogueEnabled?: boolean;
  avatarId?: string | null;
  bodyType?: "male" | "female";
  base: string;
  disabled: boolean;
  available: boolean;
  providerLabel: string;
  onBusy: (busy: boolean) => void;
  onResult: (image: string, label: string, adaptation?: Adaptation) => void;
};

export default function LinkTryOn({ catalogueEnabled=false, avatarId, bodyType = "male", base, disabled, available, providerLabel, onBusy, onResult }: Props) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [images, setImages] = useState<ProductImage[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [garmentType, setGarmentType] = useState<GarmentType | null>(null);
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<"idle" | "reading" | "generating">("idle");
  const [error, setError] = useState("");
  const [notice,setNotice]=useState('');
  const [sourceUrl,setSourceUrl]=useState(''),[variant,setVariant]=useState(''),[garmentName,setGarmentName]=useState('');
  const [saved,setSaved]=useState<StoreGarment|null>(null),[matches,setMatches]=useState<GarmentMatches>(emptyMatches);
  const [catalogueRevision,setCatalogueRevision]=useState(0),[lookupRevision,setLookupRevision]=useState(0);
  const [lookup,setLookup]=useState<{base:string;garmentId:string;avatarId:string;garmentType:string;bodyType:string;image?:string;id?:string;error?:string}|null>(null);
  const file = useRef<HTMLInputElement>(null);
  const busy = state !== "idle" || disabled;
  const canLookup=Boolean(catalogueEnabled&&saved&&avatarId&&base&&garmentType===saved.garmentType);
  const lookupCurrent=canLookup&&lookup?.base===base&&lookup?.garmentId===saved?.id&&lookup?.avatarId===avatarId&&lookup?.garmentType===garmentType&&lookup?.bodyType===bodyType;
  const cached=lookupCurrent&&!lookup?.error ? lookup?.image : undefined;
  useEffect(()=>{
    let cancelled=false;let timer:ReturnType<typeof setTimeout>|undefined;setLookup(null);setConsent(false);
    if(catalogueEnabled&&saved&&avatarId&&base&&garmentType===saved.garmentType){
      const context={base,garmentId:saved.id,avatarId,garmentType,bodyType};
      timer=setTimeout(()=>void findAdaptation(saved.id,{avatar:base,avatarId,garmentType,bodyType}).then(result=>{
        if(!cancelled)setLookup({...context,...(result.match?{image:result.image,id:result.id}:{})});
      }).catch(e=>{if(!cancelled)setLookup({...context,error:e.message});}),250);
    }
    return()=>{cancelled=true;clearTimeout(timer);};
  },[catalogueEnabled,saved?.id,avatarId,base,garmentType,bodyType,lookupRevision]);

  function begin(next: "reading" | "generating") { setState(next); onBusy(true); setError(""); setNotice(''); setCreditsRequired(false); }
  function finish() { setState("idle"); onBusy(false); }
  function accountExpired(code?: string) { if (code === "account_required") window.dispatchEvent(new Event("forme-account-expired")); }
  function applyProduct(nextTitle: string, nextImages: ProductImage[], link='') {
    setTitle(nextTitle); setImages(nextImages); setChosen(nextImages[0]?.image ?? null);
    setSaved(null);setSourceUrl(link);setVariant('');setGarmentName(nextTitle.slice(0,100));setMatches(emptyMatches());
    const guess=guessGarmentType(nextTitle); setGarmentType(bodyType === "male" && ["dress","skirt","saree","lehenga","blouse"].includes(guess || "") ? null : guess); setConsent(false);
  }

  async function loadStored(item:StoreGarment) {
    const g=await getGarment(item.id);
    if(!g.image)throw new Error('The saved garment photo is unavailable.');
    applyProduct(g.name,[{source:'catalogue',image:g.image}],g.sourceUrl);
    setVariant(g.variant);setSaved(g);
    const supported=bodyType==='female'||!['dress','skirt','saree','lehenga','blouse'].includes(g.garmentType);
    setGarmentType(supported?g.garmentType:null);
    if(!supported)setSaved(null);
    setNotice(supported?'Saved garment selected. No website read or AI request was made.':'Choose a compatible garment category for this body library.');
  }
  async function chooseStored(item:StoreGarment) {
    if(busy)return;begin('reading');
    try{await loadStored(item);}catch(e){setError((e as Error).message);}finally{finish();}
  }
  async function findProduct(readWebsite=false) {
    if (!url.trim() || busy) return;
    begin("reading");
    try {
      if(catalogueEnabled&&!readWebsite){
        const found=await matchGarments({url:url.trim()});
        if(found.linked.length===1){await loadStored(found.linked[0]);return;}
        if(found.linked.length>1){applyProduct('',[]);setMatches(found);setNotice('Choose the saved product and variant below, or read the website again.');return;}
      }
      const response = await requestApi("/api/product-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim() }) }, 45000);
      const data = await response.json();
      accountExpired(data.code);
      if (!response.ok) throw new Error(data.error || "The product link could not be read.");
      const valid = (Array.isArray(data.images) ? data.images : []).filter((item: ProductImage) => typeof item?.image === "string" && item.image.startsWith("data:image/jpeg;base64,"));
      if (!valid.length) throw new Error("No product images were found. Upload the product image instead.");
      applyProduct(typeof data.title === "string" ? data.title : "", valid, typeof data.url==='string'?data.url:url.trim());
      if(catalogueEnabled){try{setMatches(await matchGarments({image:valid[0].image}));}catch{setNotice('Photos loaded. The duplicate check is unavailable; saving will still check exact duplicates.');}}
    } catch (e) {
      setError(e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "The website took too long to respond. Try again or upload the product image." : (e as Error).message);
    } finally { finish(); }
  }

  async function uploadProduct(selected?: File) {
    if (!selected || busy) return;
    begin('reading');
    try {
      const image = await readPhoto(selected);
      applyProduct(selected.name.replace(/\.[^.]+$/, "").slice(0, 100), [{ source: "upload", image }]);
      if(catalogueEnabled){try{setMatches(await matchGarments({image}));}catch{setNotice('Photo loaded. The duplicate check is unavailable; saving will still check exact duplicates.');}}
    } catch (e) { setError((e as Error).message); } finally { finish(); }
  }

  async function keepGarment() {
    if(!chosen||!garmentType||!garmentName.trim()||busy)return;begin('reading');
    try{const result=await saveGarment({name:garmentName,garmentType,variant,sourceUrl,image:chosen});
      await loadStored(result.garment);setMatches(emptyMatches());setCatalogueRevision(n=>n+1);
      setNotice(result.duplicate?'This photo and variant are already saved. The existing garment is selected.':'Garment saved to your store. It can be selected for any customer.');
    }catch(e){setError((e as Error).message);}finally{finish();}
  }
  async function forgetAdaptation() {
    if(!saved||!lookupCurrent||!lookup?.id||busy||!window.confirm('Forget this saved adaptation? Creating it again will require a new AI request.'))return;
    begin('reading');try{await deleteAdaptation(saved.id,lookup.id);setLookupRevision(n=>n+1);setCatalogueRevision(n=>n+1);}catch(e){setError((e as Error).message);}finally{finish();}
  }

  const [creditsRequired,setCreditsRequired]=useState(false);
  async function putOn() {
    setCreditsRequired(false);
    if (!chosen || !garmentType || !consent || !base || busy || !available || (canLookup&&(!lookupCurrent||lookup?.error||cached))) return;
    begin("generating");
    setConsent(false);
    try {
      const response = await requestApi("/api/tryon", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId:crypto.randomUUID(), avatar: base, bodyType, garmentType, title, consent: true, consentScope: "avatar-and-garment", consentProvider: "gemini", ...(saved&&avatarId?{garmentId:saved.id,avatarId}:{garment:chosen}) }),
      }, 200000);
      const data = await response.json();
      accountExpired(data.code);
      if (!response.ok && data.code === "credits_required") setCreditsRequired(true);
      if (!response.ok) throw new Error(data.error || "Clothing try-on failed. The avatar is unchanged.");
      if (data.kind !== "garment-tryon" || typeof data.image !== "string" || !data.image.startsWith("data:image/png;base64,"))
        throw new Error("The studio returned an unsupported result. Update the studio and try again.");
      const label = garmentChoices.find(([id]) => id === garmentType)?.[1] ?? "Garment";
      onResult(data.image, title ? `${label} · ${title}` : label, {garmentId:data.garmentId,reuseReceipt:data.reuseReceipt,reused:data.reused,reuseWarning:data.reuseWarning});
      setConsent(false);
    } catch (e) {
      setError(e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "The request timed out. The provider may still have processed it; check before retrying." : (e as Error).message);
    } finally { finish(); }
  }

  return <section className="outfit-panel link-tryon" aria-label="Try clothes from a product link">
    <h2><Link2 size={20}/> From any clothing website</h2>
    <p>Paste a product link. The studio finds the product photos; choose the photo and what to put on the avatar.</p>
    {catalogueEnabled&&<GarmentCatalogue disabled={busy} refresh={catalogueRevision} onUse={g=>void chooseStored(g)} onDelete={id=>{if(saved?.id===id)setSaved(null);setMatches(m=>({exact:m.exact.filter(g=>g.id!==id),linked:m.linked.filter(g=>g.id!==id),similar:m.similar.filter(g=>g.id!==id)}));}} onBusy={onBusy}/>}
    {!available && <p className="small-footnote" role="note">Product-link try-on needs the Gemini provider configured on the studio. Sample layers below still work.</p>}
    <div className="link-row">
      <input type="url" inputMode="url" placeholder="https://www.example.com/men-shirt/123" aria-label="Product link" value={url} disabled={busy}
        onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void findProduct(); }}/>
      <button className="button secondary" disabled={busy || !url.trim()} onClick={() => void findProduct()}><Search size={16}/>{state === "reading" ? "Reading…" : "Find"}</button>
    </div>
    {catalogueEnabled&&url.trim()&&<button className="button back-button" disabled={busy} onClick={()=>void findProduct(true)}>Read website again</button>}
    <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="outfit-file" aria-label="Upload product photo" disabled={busy}
      onChange={e => { void uploadProduct(e.target.files?.[0]); e.target.value = ""; }}/>
    <button className="button back-button full-width" disabled={busy} onClick={() => file.current?.click()}><Upload size={16}/> Or upload a product photo / screenshot</button>
    {catalogueEnabled&&<MatchSuggestions matches={matches} disabled={busy} onUse={g=>void chooseStored(g)}/>}

    {images.length > 0 && <>
      {title && <p className="product-title"><strong>{title}</strong></p>}
      <div className="product-images" role="group" aria-label="Product photos">
        {images.map((item, index) => <button key={item.image.slice(-40) + index} className="garment-tile" disabled={busy} aria-pressed={chosen === item.image} onClick={() => { if(chosen!==item.image){setSaved(null);setMatches(emptyMatches());}setChosen(item.image); setConsent(false); }}>
          <img src={item.image} alt={`Product photo ${index + 1}`}/></button>)}
      </div>
      <h3 className="link-question">What should the avatar wear from this?</h3>
      <div className="garment-chips" role="group" aria-label="Garment type">
        {garmentChoices.filter(([id])=>bodyType === "female" || !["dress","skirt","saree","lehenga","blouse"].includes(id)).map(([id, label]) => <button key={id} disabled={busy} aria-pressed={garmentType === id} onClick={() => { if(saved?.garmentType!==id)setSaved(null);setGarmentType(id); setConsent(false); }}>{label}</button>)}
      </div>
      {catalogueEnabled&&<div className="catalogue-save">
        {saved?<p>Saved in My store clothes: <strong>{saved.name}{saved.variant?` · ${saved.variant}`:''}</strong></p>:<>
          <label>Garment name<input maxLength={100} value={garmentName} disabled={busy} onChange={e=>setGarmentName(e.target.value)}/></label>
          <label>Colour / size / SKU variant<input maxLength={80} value={variant} disabled={busy} onChange={e=>setVariant(e.target.value)}/></label>
          <button className="button secondary full-width" disabled={busy||!garmentType||!garmentName.trim()} onClick={()=>void keepGarment()}>Save garment to store</button>
          <p className="small-footnote">Saves this product photo and category to your private store catalogue. No AI charge. Save the garment before putting it on to enable reuse of the adapted result.</p>
        </>}
        {!avatarId&&<p className="small-footnote">Save this customer avatar to the store account to reuse its adapted results.</p>}
      </div>}
      {canLookup&&!lookupCurrent&&<p role="status">Checking for a saved adaptation…</p>}
      {lookupCurrent&&lookup?.error&&<div><p role="alert" className="error-banner">{lookup.error}</p><button className="button secondary" disabled={busy} onClick={()=>setLookupRevision(n=>n+1)}>Check saved result again</button></div>}
      {cached?<div className="saved-adaptation"><p>An approved result matches this exact avatar, starting outfit and garment.</p>
        <button className="button primary full-width" disabled={busy} onClick={()=>{if(!cached||!garmentType)return;onResult(cached,`${garmentChoices.find(([id])=>id===garmentType)?.[1]} · ${title}`,{garmentId:saved?.id,reused:true});}}>Use saved result — no AI charge</button>
        <button className="button back-button" disabled={busy} onClick={()=>void forgetAdaptation()}>Forget saved adaptation</button></div>:<>
      <label className="consent"><input type="checkbox" checked={consent} disabled={busy || !available} onChange={e => setConsent(e.target.checked)}/>
        <span>The customer agrees to send their avatar and this product photo to {providerLabel} to create the try-on.</span></label>
      <button className="button primary full-width" disabled={busy || !available || !consent || !chosen || !garmentType || !base || (canLookup&&(!lookupCurrent||!!lookup?.error))} onClick={() => void putOn()}>
        <Sparkles size={17}/>{state === "generating" ? "Dressing the avatar…" : "Put on avatar"}</button>
      <p className="small-footnote">One AI request per garment; a provider charge may apply. Add the next item after this one to build a full outfit. Results are approximate and need review.</p>
      </>}
    </>}
    {error && <p role="alert" className="error-banner">{error}{creditsRequired&&<CreditHelp/>}</p>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
