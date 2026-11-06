import {useEffect,useState} from 'react';
import {catalogueApi} from './catalogue';
type Product={id:string;name:string;garmentType:string;stock:string;enabled:boolean;eligible:boolean};
type Connection={id:string;shop:string;primaryHost:string;status:string;enabled:boolean;revision:string};
type Summary={available:boolean;setupMessage:string;canEdit:boolean;installation:Connection|null;products:Product[];productsTotal:number};

export default function ShopifyShopper(){
  const [data,setData]=useState<Summary|null>(null),[products,setProducts]=useState<Product[]>([]),[shop,setShop]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[search,setSearch]=useState(''),[draft,setDraft]=useState(''),[offset,setOffset]=useState(0);
  const path='/api/shopify-shopper/products?'+new URLSearchParams({search,offset:String(offset)});
  async function load(){const [summary,page]=await Promise.all([catalogueApi('/api/shopify-shopper'),catalogueApi(path)]);setData(summary);setProducts(page.products);}
  useEffect(()=>{let live=true;setError('');void Promise.all([catalogueApi('/api/shopify-shopper'),catalogueApi(path)]).then(([summary,page])=>{if(live){setData(summary);setProducts(page.products);}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[path]);
  async function action(fn:()=>Promise<unknown>,message:string){setBusy(true);setError('');setNotice('');try{await fn();await load();setNotice(message);return true;}catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}}
  async function connect(){setBusy(true);setError('');try{const result=await catalogueApi('/api/shopify-shopper/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({shopDomain:shop})});window.location.assign(result.authorizationUrl);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const json=(path:string,body:unknown)=>catalogueApi(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  async function choose(product:Product,enabled:boolean){
    const revision=data!.installation!.revision;
    setProducts(current=>current.map(row=>row.id===product.id?{...row,enabled}:row));
    const ok=await action(()=>json('/api/shopify-shopper/products/'+encodeURIComponent(product.id),{enabled,revision}),'Product selection saved. Older launch tickets are invalidated.');
    if(!ok)setProducts(current=>current.map(row=>row.id===product.id?{...row,enabled:product.enabled}:row));
  }
  return <main className="billing-page shopify-settings"><nav><a href="/">Back to Forme</a><a href="/shopper-spending">Shopper spending</a></nav><h1>Shopify try-on button</h1>
    <p>Connect a Shopify app installation to this Forme store, choose products and test their signed launch.</p>
    <p className="shopper-stage">Setup preview only. The button opens a branded product page; customer photo upload and AI try-on are still being built. Connecting and previewing use no AI credits.</p>
    {error&&<p role="alert" className="error-banner">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {data&&<>{!data.available&&<p role="status">{data.setupMessage}</p>}
    <section><h2>Shopify connection</h2>{data.installation?<><p><strong>{data.installation.shop}</strong> · {data.installation.status}</p><p>Verified storefront: {data.installation.primaryHost}</p><p>{data.installation.enabled?'Setup preview is enabled.':'Setup preview is disabled.'}</p>{data.installation.status==='reconnect_required'&&<p>The last connection did not finish. Connect Shopify again, or disconnect this store connection.</p>}</>:<p>No Shopify app is connected to this store.</p>}
    {data.canEdit?<><form onSubmit={e=>{e.preventDefault();void connect();}}><label className="shopify-domain">Shopify shop address<input required type="text" placeholder="shop-name.myshopify.com" maxLength={100} value={shop} disabled={busy||!data.available} onChange={e=>setShop(e.target.value)}/></label><p>You will approve the dedicated Forme app on Shopify. Reconnecting pauses this preview and replaces the app’s four lifecycle subscriptions.</p><p>The catalogue’s existing read-only connection remains separate.</p><button className="button primary" disabled={busy||!data.available}>{data.installation?.status==='installed'?'Reconnect Shopify':'Connect Shopify app'}</button></form>
    {data.installation&&['installed','reconnect_required'].includes(data.installation.status)&&<div className="shopper-actions">{data.installation.status==='installed'&&<button className="button secondary" disabled={busy||!data.available&&!data.installation.enabled} onClick={()=>void action(()=>json('/api/shopify-shopper',{enabled:!data.installation!.enabled,revision:data.installation!.revision}),data.installation!.enabled?'Setup preview disabled.':'Setup preview enabled. Add the theme block to a draft Shopify theme to test it.')}>{data.installation.enabled?'Disable setup preview':'Enable setup preview'}</button>}<button className="button secondary" disabled={busy} onClick={()=>void action(()=>catalogueApi('/api/shopify-shopper',{method:'DELETE'}),'Shopify disconnected. Stored app credentials were removed and launches revoked.')}>Disconnect Shopify</button></div>}</>:<p>Managers can view this connection. Only the owner can connect Shopify or choose products.</p>}
    <button className="button secondary" disabled={busy} onClick={()=>void action(async()=>{},'Connection refreshed.')}>Refresh Shopify connection</button></section>
    {data.installation?.status==='installed'&&<section><h2>Products allowed for setup preview</h2><p>Only products synced from this installed shop can be selected. Confirm the clothing type and stock in <a href="/catalogue">Catalogue</a> first. {data.productsTotal} synced products in this shop.</p>
    <form className="shopper-actions" onSubmit={e=>{e.preventDefault();setOffset(0);setSearch(draft);}}><label>Find Shopify products<input type="search" maxLength={100} value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)}/></label><button className="button secondary" disabled={busy}>Search products</button></form>
    {!products.length?<p>No matching synced Shopify products. Connect and sync this same shop in Catalogue.</p>:<ul className="shopify-products">{products.map(product=><li key={product.id}><div><strong>{product.name}</strong><p>{product.garmentType} · {product.stock}{!product.eligible?' · Confirm stock and clothing type before enabling.':''}</p></div>{data.canEdit?<label className="consent"><input type="checkbox" checked={product.enabled} disabled={busy||!product.eligible&&!product.enabled} onChange={e=>void choose(product,e.target.checked)}/><span>Allow {product.name}</span></label>:<p>{product.enabled?'Selected':'Not selected'}</p>}</li>)}</ul>}
    <div className="shopper-actions"><button className="button secondary" disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous products</button><button className="button secondary" disabled={busy||products.length<50} onClick={()=>setOffset(offset+50)}>More products</button></div>
    </section>}</>}
  </main>;
}
