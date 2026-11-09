// Aggregate only server-labelled activity. Never infer a historical category
// from a product/look that may have since been edited or deleted.
const metric = () => ({tryonsGenerated:0, tryonsReused:0, overlays:0, tryons:0,
  tryonSessions:0, comparisonsCompleted:0, comparisonsPartial:0, looksSaved:0,
  setsSaved:0, completeLooksSaved:0, looksShared:0, shareViews:0, purchases:0,
  untrackedProductTryons:0, unattributedPurchases:0, _sessions:new Set()});
const finish = row => {
  const {_sessions,...result} = row;
  return {...result,tryonSessions:_sessions.size,
    conversion:_sessions.size ? Math.round(result.purchases/_sessions.size*1000)/10 : null};
};
const isJewellery = ref => ref.category === 'jewellery' || !ref.category && ref.source === 'jewellery';
export function jewelleryAnalytics({stores,dates,day}) {
  const totals=metric(), byStore=new Map(stores.map(s=>[s.id,{...s,...metric()}])),
    byDay=new Map(dates.map(date=>[date,{date,...metric()}])), staff=new Map(), products=new Map();
  let unclassifiedLookEvents=0;
  const member=(storeId,user)=>{
    const key=storeId+':'+(user||'unknown');
    if(!staff.has(key))staff.set(key,{id:user||null,storeId,...metric()});
    return staff.get(key);
  };
  const product=(storeId,id)=>{
    const key=storeId+':'+id;
    if(!products.has(key))products.set(key,{id,storeId,...metric()});
    return products.get(key);
  };
  const targets=e=>[totals,byStore.get(e.store),byDay.get(day(e.createdAt)),member(e.store,e.user)];
  return {
    event(e,ref) {
      if(!isJewellery(ref)) {
        if(!ref.category&&['look_saved','look_shared','share_viewed'].includes(e.type))unclassifiedLookEvents++;
        return;
      }
      const rows=targets(e);
      const fitting=['tryon_generated','tryon_reused','jewellery_overlay_applied'].includes(e.type);
      if(fitting) {
        const key=e.type==='tryon_generated'?'tryonsGenerated':e.type==='tryon_reused'?'tryonsReused':'overlays';
        const session=e.store+':'+(ref.sessionId||ref.requestId||'legacy-'+e.createdAt+'-'+e.user);
        for(const row of rows){row[key]++;row.tryons++;row._sessions.add(session);}
        if(typeof ref.garmentId==='string') {
          const p=product(e.store,ref.garmentId);p[key]++;p.tryons++;p._sessions.add(session);
        } else for(const row of rows)row.untrackedProductTryons++;
      }
      if(e.type==='jewellery_compared'&&['complete','partial'].includes(ref.outcome))
        for(const row of rows)row[ref.outcome==='complete'?'comparisonsCompleted':'comparisonsPartial']++;
      if(e.type==='look_saved')for(const row of rows) {
        row.looksSaved++;
        if(ref.view==='complete')row.completeLooksSaved++;
        else if(ref.itemCount>=2)row.setsSaved++;
      }
      if(e.type==='look_shared'||e.type==='share_viewed')
        for(const row of rows)row[e.type==='look_shared'?'looksShared':'shareViews']++;
    },
    purchase(e,ref) {
      if(!isJewellery(ref)) {if(!ref.category)unclassifiedLookEvents++;return;}
      const rows=targets(e);
      for(const row of rows) {
        row.purchases++;
        if(!ref.sessionId||!row._sessions.has(e.store+':'+ref.sessionId))row.unattributedPurchases++;
      }
      for(const id of new Set(Array.isArray(ref.jewelleryItemIds)?ref.jewelleryItemIds:[]))
        if(typeof id==='string')product(e.store,id).purchases++;
    },
    result(db,{fullProducts=false,trackingSince}) {
      const items=[...products.values()].map(p=>{
        const saved=db.prepare('SELECT name,sku FROM garments WHERE account=? AND id=?').get(p.storeId,p.id);
        return {...finish(p),name:saved?.name||'Deleted jewellery',sku:saved?.sku||null};
      }).sort((a,b)=>b.tryons-a.tryons||a.storeId.localeCompare(b.storeId)||a.id.localeCompare(b.id));
      const members=[...staff.values()].map(p=>({...finish(p),name:p.id?db.prepare('SELECT name FROM users WHERE id=?').get(p.id)?.name||'Former staff':'Unattributed staff'})).sort((a,b)=>b.tryons-a.tryons||a.storeId.localeCompare(b.storeId)||String(a.id).localeCompare(String(b.id)));
      return {trackingSince,unclassifiedLookEvents,totals:finish(totals),days:[...byDay.values()].map(finish),stores:[...byStore.values()].map(finish),staff:members,products:fullProducts?items:items.slice(0,50),productsTracked:items.length};
    },
  };
}
