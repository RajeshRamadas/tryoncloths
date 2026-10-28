import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, RotateCcw, Shirt, Undo2, Upload } from "lucide-react";
import { baseAvatar, importGarment, renderOutfit, sampleCatalogue, type Category, type Garment, type Layer, type Placement } from "./outfits";
import { downloadAvatar } from "./images";
import { isNative } from "./native";
import LinkTryOn from "./LinkTryOn";

const categoryNames = { shirt: "Shirts & tops", trousers: "Trousers", shoes: "Shoes" };
const layerNames = { shirt: "top", trousers: "trousers", shoes: "shoes" };
const originalNames = { shirt: "Original top", trousers: "Original bottoms", shoes: "Bare feet" };

type Props = { active: boolean; profile: { id: string; name: string; index: number }; personalized: string | null; tryOn: { available: boolean; providerLabel: string }; onBack: () => void; onBusy: (busy: boolean) => void };
type Dressed = { image: string; label: string; previousLayers: Layer[] };
export default function OutfitStudio({ active, profile, personalized, tryOn, onBack, onBusy }: Props) {
  const catalogue = useMemo(() => sampleCatalogue(profile.id, !!personalized), [profile.id, personalized]);
  const [imports, setImports] = useState<Garment[]>([]);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [category, setCategory] = useState<Category>("shirt");
  const [base, setBase] = useState("");
  // AI try-on results stack on the avatar; each one becomes the next base.
  const [dressed, setDressed] = useState<Dressed[]>([]);
  const current = dressed.at(-1)?.image || base;
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(true);
  const [reviewed, setReviewed] = useState(false);
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const selected = layers.find(item => item.garment.category === category);
  useEffect(() => { if (active) heading.current?.focus(); }, [active]);
  useEffect(() => {
    let cancelled = false;
    baseAvatar(profile.index, personalized).then(value => { if (!cancelled) setBase(value); }).catch(e => { if (!cancelled) { setError(e.message); setRendering(false); } });
    return () => { cancelled = true; };
  }, [profile.index, personalized]);
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setRendering(true); setResult("");
    renderOutfit(current, layers).then(canvas => { if (!cancelled) { setResult(canvas.toDataURL("image/png")); setRendering(false); } })
      .catch(e => { if (!cancelled) { setError(e.message); setRendering(false); } });
    return () => { cancelled = true; };
  }, [current, layers]);
  function dress(image: string, label: string) {
    // Sample layers were included in the AI input, so they are now part of the image.
    setDressed(items => [...items, { image, label, previousLayers: layers }]);
    update([]);
    setNotice("Try-on created. Check the face, body and garment before keeping this look.");
  }
  function undoDress() { const previous = dressed.at(-1); if (!previous) return; setDressed(items => items.slice(0, -1)); update(previous.previousLayers); }
  function update(next: Layer[]) { setLayers(next); setReviewed(false); setError(""); setNotice(""); setRendering(true); }
  function select(garment: Garment) { update([...layers.filter(l => l.garment.category !== category), { garment, placement: { ...garment.placement } }]); }
  function adjust(field: keyof Placement, value: number) {
    update(layers.map(l => l.garment.category === category ? { ...l, placement: { ...l.placement, [field]: value / 100 } } : l));
  }
  async function upload(file?: File) {
    if (!file) return;
    if (imports.length >= 12) { setError("Remove an imported layer before adding more. This session holds up to 12 layers."); return; }
    setBusy(true); onBusy(true); setError("");
    try { const garment = await importGarment(file, category, profile.id, !!personalized); setImports(items => [...items, garment]); select(garment); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); onBusy(false); }
  }
  async function save() {
    if (!reviewed || !result || rendering || busy) return;
    setBusy(true); onBusy(true); setError("");
    try { const saved = await downloadAvatar(profile.index, result, `${profile.id}-outfit`); setNotice(saved ? "Outfit PNG prepared. Your original avatar is unchanged." : "Export cancelled."); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); onBusy(false); }
  }
  return <section className="outfit-studio" hidden={!active} aria-label="Clothing try-on">
    <header className="outfit-header"><button className="button secondary" disabled={busy} onClick={onBack}><ArrowLeft size={17}/> Back to avatar</button><span className="outfit-free">Sample layers: no AI · Product links: one AI request per garment</span></header>
    <div className="outfit-intro"><span className="eyebrow">YOUR FITTING ROOM</span><h1 ref={heading} tabIndex={-1}>Find an outfit that feels right.</h1><p>Keep your avatar. Paste a product link from any clothing website, or choose a sample top, trousers and shoes, then check the look together.</p></div>
    <div className="outfit-layout">
      <div className="outfit-preview-card"><div className="outfit-preview-title"><strong>{profile.name} · {personalized ? "Customer avatar" : "Sample avatar"}</strong><span>Outfit preview</span></div>
        <div className="outfit-preview" aria-busy={rendering}>{result && <img src={result} alt="Avatar wearing the selected outfit"/>}{rendering && <span className="outfit-rendering" role="status">Updating preview…</span>}</div>
        <p className="outfit-caption">Approximate visual styling. This preview does not predict size, fit or fabric drape.</p>
      </div>
      <div className="outfit-controls">
        <LinkTryOn base={result} disabled={busy || rendering} available={tryOn.available} providerLabel={tryOn.providerLabel} onBusy={value => { setBusy(value); onBusy(value); }} onResult={dress}/>
        {dressed.length > 0 && <section className="outfit-panel"><h2>Wearing from product links</h2>
          <ol className="dressed-list">{dressed.map((item, index) => <li key={index}>{item.label}</li>)}</ol>
          <button className="button secondary" disabled={busy} onClick={undoDress}><Undo2 size={16}/> Undo last garment</button>
        </section>}
        <section className="outfit-panel"><h2><Shirt size={20}/> Choose your clothes</h2><p>Realistic AI-created samples are included. Import prepared layers to preview your store’s garments.</p>
          <div className="outfit-tabs" role="group" aria-label="Clothing category">{(["shirt", "trousers", "shoes"] as Category[]).map(c => <button key={c} disabled={busy} aria-pressed={category === c} onClick={() => setCategory(c)}>{categoryNames[c]}</button>)}</div>
          <div className="garment-grid"><button className="garment-tile" disabled={busy} aria-pressed={!selected} onClick={() => update(layers.filter(l => l.garment.category !== category))}><span className="garment-original"><RotateCcw/></span><strong>{originalNames[category]}</strong></button>
            {[...catalogue, ...imports].filter(g => g.category === category).map(g => <button key={g.id} className="garment-tile" disabled={busy} aria-pressed={selected?.garment.id === g.id} onClick={() => select(g)}><img src={g.source} alt=""/><strong>{g.name}</strong><small>{g.imported ? "Your layer" : "Sample"}</small></button>)}</div>
          <input ref={input} type="file" accept="image/png,image/webp" aria-label="Import clothing layer" className="outfit-file" disabled={busy} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }}/>
          <button className="button secondary full-width" disabled={busy} onClick={() => input.current?.click()}><Upload size={16}/> Import {layerNames[category]} layer</button>
          <p className="small-footnote">Transparent PNG or WebP; import footwear as a pair. Front view in the avatar’s pose. Layers stay in this session. Importing does not remove backgrounds or reshape garments.</p>
        </section>
        {selected && <section className="outfit-panel"><h2>Adjust placement</h2><p>Line up the neckline, waistband or shoes. Check that the original clothes are covered.</p>
          {([['x', 'Left / right', -30, 100], ['y', 'Up / down', -30, 100], ['width', 'Width', 5, 150], ['height', 'Length', 5, 150]] as const).map(([key, label, min, max]) => <label className="outfit-slider" key={key}><span>{label}<output>{Math.round(selected.placement[key] * 100)}%</output></span><input aria-label={`${category} ${label}`} type="range" min={min} max={max} step="0.5" value={selected.placement[key] * 100} disabled={busy} onChange={e => adjust(key, Number(e.target.value))}/></label>)}
          <button className="button secondary" disabled={busy} onClick={() => select(selected.garment)}>Reset placement</button>
          {selected.garment.imported && <button className="button back-button" disabled={busy} onClick={() => { setImports(items => items.filter(g => g.id !== selected.garment.id)); update(layers.filter(l => l !== selected)); }}>Remove imported layer</button>}
        </section>}
        <section className="outfit-panel"><h2>Keep this look</h2><label className="consent"><input type="checkbox" checked={reviewed} disabled={busy || rendering || !result || (!layers.length && !dressed.length)} onChange={e => setReviewed(e.target.checked)}/><span>I have checked clothing placement and approve this outfit preview.</span></label>
          <button className="button primary full-width" disabled={!reviewed || !result || rendering || busy || (!layers.length && !dressed.length)} onClick={() => void save()}><Download size={17}/>{busy ? "Preparing…" : isNative ? "Save or share outfit" : "Download outfit"}</button>
          <button className="button back-button full-width" disabled={busy || (!layers.length && !dressed.length)} onClick={() => { setDressed([]); update([]); }}><RotateCcw size={16}/> Reset outfit</button>
          {error && <p role="alert" className="error-banner">{error}</p>}{notice && <p role="status">{notice}</p>}
        </section>
      </div>
    </div>
  </section>;
}
