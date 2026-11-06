import {useEffect,useRef,useState} from 'react';
import {customerRequest,type Customer,type CustomerRef} from './customers';

type Props={selected:CustomerRef|null; disabled:boolean; onSelect:(customer:CustomerRef|null,measurements?:Customer['measurements'])=>void; onUpdate:(customer:CustomerRef)=>void};
export default function CustomerPicker({selected,disabled,onSelect,onUpdate}:Props){
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [phone,setPhone]=useState(''),[matches,setMatches]=useState<Customer[]>([]);
  const [searched,setSearched]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [editing,setEditing]=useState<Customer|null>(null),[form,setForm]=useState(false),[confirmErase,setConfirmErase]=useState(false);
  const [name,setName]=useState(''),[mobile,setMobile]=useState(''),[notes,setNotes]=useState(''),[marketing,setMarketing]=useState(false);
  const [height,setHeight]=useState(''),[weight,setWeight]=useState('');
  const locked=disabled||busy;
  async function search(){setBusy(true);setError('');setMatches([]);setSearched(false);try{setMatches((await customerRequest(`/search?phone=${encodeURIComponent(phone)}`)).customers);setSearched(true);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function fill(customer:Customer|null){setEditing(customer);setName(customer?.name||'');setMobile(customer?.phoneE164||phone);setNotes(customer?.notes||'');setMarketing(customer?.marketingOptIn||false);setHeight(customer?.measurements?String(customer.measurements.heightCm):'');setWeight(customer?.measurements?String(customer.measurements.weightKg):'');setForm(true);setConfirmErase(false);setError('');}
  async function edit(){if(!selected)return;setBusy(true);setError('');try{fill((await customerRequest(`/${selected.id}`)).customer);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function save(){setBusy(true);setError('');try{
    const customer:Customer=(await customerRequest(editing?`/${editing.id}`:'',editing?'PATCH':'POST',{name,phoneE164:mobile,notes,marketingOptIn:marketing,optInSource:marketing?(editing?.marketingOptIn?editing.optInSource:'in_store'):null,measurements:height||weight?{heightCm:Number(height),weightKg:Number(weight)}:null})).customer;
    if(!mounted.current)return;
    if(editing)onUpdate(customer);else onSelect(customer,customer.measurements);
    setForm(false);setMatches([]);setSearched(false);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function erase(){if(!selected)return;setBusy(true);setError('');try{await customerRequest(`/${selected.id}`,'DELETE');if(!mounted.current)return;onSelect(null);setConfirmErase(false);setForm(false);setMatches([]);setSearched(false);setPhone('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <section className="customer-picker" aria-label="Store customer">
    <h3>Find customer by mobile</h3>
    <p>Keep avatars together for the next visit. Selecting a different customer clears the current photos and preview.</p>
    {selected&&<div className="customer-selected"><strong>{selected.name}</strong><span>{selected.phoneE164}</span><div className="customer-actions">
      <button className="button secondary" disabled={locked} onClick={()=>void edit()}>Edit customer</button>
      <button className="button back-button" disabled={locked} onClick={()=>{onSelect(null);setForm(false);setConfirmErase(false);}}>Clear customer selection</button>
      <button className="button back-button" disabled={locked} onClick={()=>{setConfirmErase(true);setForm(false);}}>Delete customer</button>
    </div></div>}
    {confirmErase&&<div className="saved-delete"><p>Delete {selected?.name} and all their saved avatars, looks, adaptations and share links from this store? Downloaded copies are unaffected. This cannot be undone.</p><button className="button secondary" disabled={locked} onClick={()=>void erase()}>Permanently delete customer</button><button className="button back-button" disabled={locked} onClick={()=>setConfirmErase(false)}>Cancel customer deletion</button></div>}
    <form onSubmit={e=>{e.preventDefault();void search();}}>
      <label>Customer mobile number<input type="tel" autoComplete="off" value={phone} maxLength={40} disabled={locked} placeholder="Enter at least 3 digits" onChange={e=>{setPhone(e.target.value);setSearched(false);setMatches([]);}}/></label>
      <div className="customer-actions"><button className="button secondary" disabled={locked||phone.replace(/\D/g,'').length<3}>Find customer</button><button type="button" className="button secondary" disabled={locked} onClick={()=>fill(null)}>New customer</button></div>
    </form>
    {searched&&!matches.length&&<p role="status">No customers found in this store.</p>}
    {matches.length>0&&<ul className="customer-matches">{matches.map(customer=><li key={customer.id}><button className="button secondary" disabled={locked} onClick={()=>{onSelect(customer,customer.measurements);setMatches([]);setSearched(false);setForm(false);setConfirmErase(false);}}>{customer.name} · {customer.phoneE164}</button></li>)}</ul>}
    {matches.length===50&&<p>Showing the first 50 matches. Enter more digits to narrow the search.</p>}
    {form&&<form aria-label={editing?'Edit customer profile':'New customer profile'} onSubmit={e=>{e.preventDefault();void save();}}>
      <h4>{editing?'Edit customer profile':'New customer profile'}</h4>
      <label>Customer name<input value={name} required maxLength={80} disabled={locked} onChange={e=>setName(e.target.value)}/></label>
      <label>Saved mobile number<input type="tel" value={mobile} required maxLength={40} disabled={locked} onChange={e=>setMobile(e.target.value)}/></label><p className="small-footnote">India uses +91 by default. For other countries, include + and the country code.</p>
      <label>Customer notes<textarea value={notes} maxLength={2000} disabled={locked} onChange={e=>setNotes(e.target.value)}/></label>
      <div className="measurement-grid"><label>Profile height (cm)<input type="number" min="140" max="210" step="any" value={height} disabled={locked} onChange={e=>setHeight(e.target.value)}/></label><label>Profile weight (kg)<input type="number" min="35" max="200" step="any" value={weight} disabled={locked} onChange={e=>setWeight(e.target.value)}/></label></div>
      <p className="small-footnote">Measurements are optional. Update them here when they change; existing avatars keep their original measurements.</p>
      <label className="consent"><input type="checkbox" checked={marketing} disabled={locked} onChange={e=>setMarketing(e.target.checked)}/><span>The customer agrees to receive marketing messages. Optional; avatar creation does not require this.</span></label>
      <div className="customer-actions"><button className="button primary" disabled={locked}>Save customer</button><button type="button" className="button back-button" disabled={locked} onClick={()=>setForm(false)}>Cancel customer edit</button></div>
    </form>}
    {busy&&<p role="status">Updating customer details…</p>}
    {error&&<p role="alert" className="error-banner">{error}</p>}
  </section>;
}
