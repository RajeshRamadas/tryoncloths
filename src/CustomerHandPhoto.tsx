import {useEffect,useRef,useState} from 'react';
import {readPhoto,loadImage} from './images';
import {handMarkerIds,validateCustomerHandPoints} from './customer-hands';
export type HandPoint={x:number;y:number;angle:number;widthPx:number};
export type HandPoints=Partial<Record<string,HandPoint>>;
export const validHandPoints=(points:HandPoints)=>{try{validateCustomerHandPoints(points);return true;}catch{return false;}};
const label=(id:string)=>id.replace('.', ' ').replace(/^./,s=>s.toUpperCase());
export function HandPhotoMarkers({image,points,alt,onPoint,selected}:{image:string;points:HandPoints;alt:string;selected?:string;onPoint?:(x:number,y:number)=>void}){
  return <svg className="customer-hand-photo" viewBox="0 0 1024 1024" role="img" aria-label={alt} onPointerDown={onPoint?e=>{const r=e.currentTarget.getBoundingClientRect();onPoint(Math.round((e.clientX-r.left)/r.width*1024),Math.round((e.clientY-r.top)/r.height*1024));}:undefined}>
    <image href={image} width="1024" height="1024"/>
    {Object.entries(points).map(([id,p])=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?<g key={id} transform={`translate(${p.x} ${p.y}) rotate(${p.angle})`} pointerEvents="none"><line x1={-p.widthPx/2} x2={p.widthPx/2} stroke="#1266bf" strokeWidth="6"/><circle r="10" fill={selected===id?'#efae3d':'#fff'} stroke="#1266bf" strokeWidth="4"/><text y="-18" textAnchor="middle" fontSize="36" fill="#043b72" stroke="white" strokeWidth="5" paintOrder="stroke">{handMarkerIds.indexOf(id)+1}</text></g>:null)}
  </svg>;
}
export default function CustomerHandPhoto({photo,points,onChange,disabled}:{photo:string;points:HandPoints;onChange:(image:string,points:HandPoints)=>void;disabled:boolean}){
  const [selected,setSelected]=useState(handMarkerIds[0]),[loading,setLoading]=useState(false),[error,setError]=useState('');const version=useRef(0);
  useEffect(()=>()=>{version.current++;},[]);
  async function upload(file:File){const op=++version.current;onChange('',{});setLoading(true);setError('');try{
    if(!file.size||file.size>5*1024*1024)throw new Error('Choose a hand photo under 5 MB.');
    const source=await readPhoto(file),image=await loadImage(source),canvas=document.createElement('canvas');if(image.width<256||image.height<256)throw new Error('Use a colour hand photo at least 256 pixels on each side.');canvas.width=canvas.height=1024;const ctx=canvas.getContext('2d')!,scale=Math.min(1024/image.width,1024/image.height),w=Math.round(image.width*scale),h=Math.round(image.height*scale);ctx.fillStyle='#fff';ctx.fillRect(0,0,1024,1024);ctx.drawImage(image,Math.round((1024-w)/2),Math.round((1024-h)/2),w,h);
    const normalized=canvas.toDataURL('image/png');if(normalized.length>7_000_000)throw new Error('Use a smaller, clear hand photo.');if(version.current===op){setSelected(handMarkerIds[0]);onChange(normalized,{});}
  }catch(e){if(version.current===op)setError((e as Error).message);}finally{if(version.current===op)setLoading(false);}}
  const point=points[selected],defaults={x:NaN,y:NaN,angle:0,widthPx:selected.endsWith('.wrist')?180:52};
  function edit(field:keyof HandPoint,value:number){onChange(photo,{...points,[selected]:{...(point||defaults),[field]:value}});}
  const count=handMarkerIds.filter(id=>points[id]&&Number.isFinite(points[id]!.x)&&Number.isFinite(points[id]!.y)).length;
  return <div className="customer-hand-editor">
    <p>Photograph the customer’s own two hands together, palms down, fingers pointing up, slightly apart, with both wrists visible. Put the left hand in the left half and the right hand in the right half. Use even lighting and a plain light background. Remove jewellery only with agreement.</p>
    <label>Choose customer hand photo<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled||loading} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void upload(f);}}/></label>
    <label>Take customer hand photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={disabled||loading} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void upload(f);}}/></label>
    {loading&&<p role="status">Opening the photo locally…</p>}{error&&<p role="alert">{error}</p>}
    {photo&&<><p>Mark where a ring or bangle would sit on each of the ten fingers and two wrists. Set each band’s width and angle to match the photo. These are image positions, not physical size measurements.</p>
      <label>Hand placement marker<select aria-label="Hand placement marker" value={selected} disabled={disabled} onChange={e=>setSelected(e.target.value)}>{handMarkerIds.map(id=><option key={id} value={id}>{handMarkerIds.indexOf(id)+1}. {label(id)}{Number.isFinite(points[id]?.x)&&Number.isFinite(points[id]?.y)?' · marked':''}</option>)}</select></label>
      <p>Click the photo to mark <strong>{label(selected)}</strong>, or use the coordinate fields below. {count} of 12 markers placed.</p>
      <HandPhotoMarkers image={photo} points={points} selected={selected} alt="Customer hand photo with placement markers" onPoint={disabled?undefined:(x,y)=>{const next={...points,[selected]:{...(point||defaults),x,y}};onChange(photo,next);const missing=handMarkerIds.find(id=>!next[id]);if(missing)setSelected(missing);}}/>
      <div className="hand-marker-fields">{(['x','y','widthPx','angle'] as const).map(field=><label key={field}>{({x:'Marker X',y:'Marker Y',widthPx:'Band width (pixels)',angle:'Band angle (degrees)'})[field]}<input type="number" value={Number.isFinite((point||defaults)[field])?(point||defaults)[field]:''} disabled={disabled} min={field==='angle'?-180:field==='widthPx'?selected.endsWith('.wrist')?120:30:1} max={field==='angle'?180:field==='widthPx'?selected.endsWith('.wrist')?300:90:1022} step="1" onChange={e=>edit(field,e.target.value===''?NaN:Number(e.target.value))}/></label>)}</div>
      {count===12&&!validHandPoints(points)&&<p role="alert">Adjust the markers: keep complete bands inside each hand’s half, separate the finger markers, and place wrists below the fingers.</p>}
      <p>Only the normalized square photo is sent when you explicitly generate. Original uploads are not saved. Confirm the markers before generating; moving them later requires a new, consented cleanup.</p>
    </>}
  </div>;
}
