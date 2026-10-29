import { useState } from 'react';
import { Shirt } from 'lucide-react';
import { garmentChoices } from './garment-types';
import { listGarments, deleteGarment, type StoreGarment, type GarmentMatches } from './store-garments';

const displayName = (g:StoreGarment) => `${g.name}${g.variant ? ` · ${g.variant}` : ''}`;
export function MatchSuggestions({matches,disabled,onUse}:{matches:GarmentMatches;disabled:boolean;onUse:(g:StoreGarment)=>void}) {
  return <div className="catalogue-matches">{([
    ['exact','Already saved from this photo'],['linked','Saved products for this link'],['similar','Similar photos — confirm colour, category and variant'],
  ] as const).map(([key,label])=>matches[key].length > 0 && <section key={key} aria-label={label}><h3>{label}</h3><div className="catalogue-grid">
    {matches[key].map(g=><button key={g.id} className="garment-tile" disabled={disabled} onClick={()=>onUse(g)}><img src={g.thumbnail} alt=""/><strong>Use saved garment {displayName(g)}</strong><small>{g.garmentType}</small></button>)}
  </div></section>)}</div>;
}

export default function GarmentCatalogue({disabled,refresh,onUse,onDelete,onBusy}:{disabled:boolean;refresh:number;onUse:(g:StoreGarment)=>void;onDelete:(id:string)=>void;onBusy:(busy:boolean)=>void}) {
  const [open,setOpen]=useState(false),[items,setItems]=useState<StoreGarment[]>([]),[loaded,setLoaded]=useState(-1);
  const [category,setCategory]=useState('all'),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function show() {
    if (disabled || busy) return;
    if(open && loaded===refresh){setOpen(false);return;}
    setOpen(true);setBusy(true);onBusy(true);setError('');
    try{setItems(await listGarments());setLoaded(refresh);}catch(e){setError((e as Error).message);}finally{setBusy(false);onBusy(false);}
  }
  async function remove(g:StoreGarment) {
    if(!window.confirm(`Delete ${displayName(g)} and its saved adaptations? Your saved avatars and complete looks will remain.`))return;
    setBusy(true);onBusy(true);setError('');
    try{await deleteGarment(g.id);setItems(items=>items.filter(i=>i.id!==g.id));onDelete(g.id);}catch(e){setError((e as Error).message);}finally{setBusy(false);onBusy(false);}
  }
  const visible=items.filter(g=>(category==='all'||g.garmentType===category)&&`${g.name} ${g.variant}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="store-garments" aria-label="Store garment catalogue">
    <button className="button secondary full-width" disabled={disabled||busy} aria-expanded={open} onClick={()=>void show()}><Shirt size={18}/>{open&&loaded!==refresh?'Refresh my store clothes':'My store clothes'}</button>
    {open&&<>
      <p>Saved for your store. Choosing a garment is free. Reusing it on a different avatar or starting outfit may need one AI request.</p>
      <div className="catalogue-filters"><label>Search clothes<input value={search} onChange={e=>setSearch(e.target.value)} disabled={busy||disabled}/></label>
        <label>Filter clothes<select value={category} onChange={e=>setCategory(e.target.value)} disabled={busy||disabled}><option value="all">All categories</option>{garmentChoices.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label></div>
      {busy&&<p role="status">Updating store clothes…</p>}
      {!busy&&!error&&!visible.length&&<p>No saved clothes match. Read a product link or upload a photo below, then save the garment.</p>}
      <div className="catalogue-grid">{visible.map(g=><article key={g.id} className="catalogue-item">
        <button className="garment-tile" disabled={busy||disabled} onClick={()=>onUse(g)}><img src={g.thumbnail} alt=""/><strong>Use {displayName(g)}</strong><small>{garmentChoices.find(([id])=>id===g.garmentType)?.[1]} · {g.adaptations} saved adaptations</small></button>
        <button className="button back-button" disabled={busy||disabled} aria-label={`Delete garment ${displayName(g)}`} onClick={()=>void remove(g)}>Delete</button>
      </article>)}</div>
      {error&&<p role="alert" className="error-banner">{error}</p>}
    </>}
  </section>;
}
