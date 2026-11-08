import {useEffect,useRef,useState,type PointerEvent} from 'react';
import {loadImage} from './images';

export type OverlayPlacement={id:string;x:number;y:number;width:number;height:number;angle:number;mirror:boolean;pivotX:number;pivotY:number};
export type OverlayPrepared={base:string;asset:string;assetHash:string;placements:OverlayPlacement[];width:number;height:number;warning:string};
type Props={disabled:boolean;onPrepare:()=>Promise<OverlayPrepared|null>;onApply:(prepared:OverlayPrepared,placements:OverlayPlacement[])=>Promise<boolean>};
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));
const angle=(n:number)=>((n+540)%360)-180;
export default function JewelleryOverlay({disabled,onPrepare,onApply}:Props){
  const [prepared,setPrepared]=useState<OverlayPrepared|null>(null),[pieces,setPieces]=useState<OverlayPlacement[]>([]),[selected,setSelected]=useState(0),[ready,setReady]=useState(false),[error,setError]=useState('');
  const canvas=useRef<HTMLCanvasElement>(null),images=useRef<HTMLImageElement[]>([]),alive=useRef(true),points=useRef(new Map<number,{x:number;y:number}>()),gesture=useRef<{piece:OverlayPlacement;x:number;y:number;distance:number;angle:number}|null>(null);
  const piece=pieces[selected];
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;images.current=[];points.current.clear();const c=canvas.current;if(c){c.width=0;c.height=0;}};},[]);
  useEffect(()=>{if(!prepared)return;let active=true;setReady(false);void Promise.all([loadImage(prepared.base),loadImage(prepared.asset)]).then(value=>{if(active){images.current=value;setReady(true);}}).catch(()=>{if(active)setError('The placement images could not be opened. Reload the editor.');});return()=>{active=false;images.current=[];};},[prepared]);
  useEffect(()=>{
    const c=canvas.current;if(!c||!prepared||!ready)return;const ctx=c.getContext('2d')!;c.width=prepared.width;c.height=prepared.height;ctx.drawImage(images.current[0],0,0);
    pieces.forEach((p,i)=>{ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle*Math.PI/180);if(p.mirror)ctx.scale(-1,1);ctx.drawImage(images.current[1],-p.pivotX*p.width,-p.pivotY*p.height,p.width,p.height);if(i===selected){ctx.strokeStyle='#215b4a';ctx.lineWidth=2*prepared.width/c.getBoundingClientRect().width;ctx.setLineDash([8,5]);ctx.strokeRect(-p.pivotX*p.width,-p.pivotY*p.height,p.width,p.height);}ctx.restore();});
  },[prepared,pieces,selected,ready]);
  function update(next:Partial<OverlayPlacement>){setPieces(list=>list.map((p,i)=>i===selected?{...p,...next}:p));}
  function resize(factor:number,source=piece){if(!prepared||!source)return {};const f=clamp(factor,Math.max(2/source.width,2/source.height),Math.min(prepared.width/source.width,prepared.height/source.height));return {width:source.width*f,height:source.height*f};}
  function position(e:PointerEvent<HTMLCanvasElement>){const r=e.currentTarget.getBoundingClientRect();return {x:(e.clientX-r.left)*prepared!.width/r.width,y:(e.clientY-r.top)*prepared!.height/r.height};}
  function resetGesture(index=selected){const p=[...points.current.values()],first=p[0];if(!first||!pieces[index]){gesture.current=null;return;}const second=p[1];gesture.current={piece:{...pieces[index]},x:second?(first.x+second.x)/2:first.x,y:second?(first.y+second.y)/2:first.y,distance:second?Math.hypot(second.x-first.x,second.y-first.y):0,angle:second?Math.atan2(second.y-first.y,second.x-first.x):0};}
  function down(e:PointerEvent<HTMLCanvasElement>){if(disabled||!ready||!prepared)return;e.preventDefault();const q=position(e);let index=selected;if(points.current.size===0){let best=Infinity;pieces.forEach((p,i)=>{const distance=Math.hypot(p.x-q.x,p.y-q.y);if(distance<best){best=distance;index=i;}});setSelected(index);}e.currentTarget.setPointerCapture(e.pointerId);points.current.set(e.pointerId,q);resetGesture(index);}
  function move(e:PointerEvent<HTMLCanvasElement>){if(disabled||!prepared||!points.current.has(e.pointerId)||!gesture.current)return;e.preventDefault();points.current.set(e.pointerId,position(e));const [a,b]=[...points.current.values()],g=gesture.current,x=b?(a.x+b.x)/2:a.x,y=b?(a.y+b.y)/2:a.y;
    const next={x:clamp(g.piece.x+x-g.x,0,prepared.width),y:clamp(g.piece.y+y-g.y,0,prepared.height),...(b&&g.distance>0?{...resize(Math.hypot(b.x-a.x,b.y-a.y)/g.distance,g.piece),angle:angle(g.piece.angle+(Math.atan2(b.y-a.y,b.x-a.x)-g.angle)*180/Math.PI)}:{})};update(next);
  }
  function up(e:PointerEvent<HTMLCanvasElement>){points.current.delete(e.pointerId);resetGesture();}
  async function load(){setError('');const value=await onPrepare();if(value&&alive.current){setPrepared(value);setPieces(value.placements.map(p=>({...p})));setSelected(0);}}
  return <div className="jewellery-overlay"><h3>Overlay placement · free</h3><p>Use the saved transparent cut-out. Drag a piece, or pinch with two fingers to scale and rotate it. No images are sent to Gemini.</p><button className="button secondary" disabled={disabled} onClick={()=>void load()}>{prepared?'Reload starting placement':'Load overlay placement'}</button>{error&&<p role="alert">{error}</p>}
    {prepared&&<><p className="small-footnote">{prepared.warning} The cut-out keeps its product colours and does not simulate lighting or occlusion.</p><canvas ref={canvas} className="jewellery-overlay-canvas" aria-label="Jewellery placement canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}/>
      {piece&&<fieldset disabled={disabled||!ready}><label>Selected overlay piece<select aria-label="Selected overlay piece" value={selected} onChange={e=>setSelected(Number(e.target.value))}>{pieces.map((p,i)=><option key={p.id} value={i}>{p.id.split(':')[0]} · piece {Number(p.id.split(':')[1])+1}</option>)}</select></label>
        <div className="catalogue-filters"><label>Horizontal position<input aria-label="Overlay horizontal position" type="number" min="0" max={prepared.width} step="any" value={Math.round(piece.x)} onChange={e=>update({x:clamp(Number(e.target.value),0,prepared.width)})}/></label><label>Vertical position<input aria-label="Overlay vertical position" type="number" min="0" max={prepared.height} step="any" value={Math.round(piece.y)} onChange={e=>update({y:clamp(Number(e.target.value),0,prepared.height)})}/></label></div>
        <label>Overlay scale ({Math.round(piece.width/prepared.placements[selected].width*100)}%)<input aria-label="Overlay scale" type="range" min="10" max="400" step="1" value={piece.width/prepared.placements[selected].width*100} onChange={e=>update(resize(Number(e.target.value)/100,prepared.placements[selected]))}/></label>
        <label>Overlay rotation ({Math.round(piece.angle)}°)<input aria-label="Overlay rotation" type="range" min="-180" max="180" step="1" value={piece.angle} onChange={e=>update({angle:Number(e.target.value)})}/></label><label className="consent"><input type="checkbox" checked={piece.mirror} onChange={e=>update({mirror:e.target.checked})}/><span>Mirror selected piece</span></label>
        <button className="button secondary" onClick={()=>{setPieces(prepared.placements.map(p=>({...p})));setSelected(0);}}>Reset all placements</button><button className="button primary full-width" onClick={()=>void onApply(prepared,pieces).then(applied=>{if(applied&&alive.current)setPrepared(null);})}>Apply overlay — free</button>
      </fieldset>}
    </>}
  </div>;
}
