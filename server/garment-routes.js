import {saveOverlayAsset} from './jewellery-overlay.js';
import {recordTryon,validateSession} from './analytics-tracking.js';
import {validRequestId} from './billing.js';
import { accountUser } from './accounts.js';
import {catalogueCategory,jewelleryTypes,jewelleryMetals,bangleSizes,chooseView} from './jewellery-types.js';

export function installGarmentRoutes(app, store, config) {
  if (!store) return;
  const wrap = fn => async (req, res) => {
    try {
      const owner = accountUser(store, req);
      if (!owner) return res.status(401).json({ error: 'Sign in to your store account.', code: 'account_required' });
      if (req.method !== 'GET') {
        let allowed = false;
        try { const origin = new URL(req.get('origin')); allowed = origin.host === req.get('host') && origin.protocol === `${req.protocol}:`; } catch {}
        if (!allowed) return res.status(403).json({ error: 'Open catalogue actions from this studio website.' });
      }
      const category=catalogueCategory(req.query.category??req.body?.category,{jewelleryEnabled:config.jewelleryEnabled});
      if(req.query.category&&req.body?.category&&req.query.category!==req.body.category)return res.status(400).json({error:'Use one consistent catalogue category.'});
      if(category==='jewellery'&&req.method!=='GET'&&!req.path.endsWith('/match')&&!['owner','manager'].includes(owner.user.role))return res.status(403).json({error:'Only owners and managers can change the jewellery catalogue.'});
      req.catalogueOptions={category,jewelleryEnabled:config.jewelleryEnabled};
      await fn(req, res, owner);
    } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'The store catalogue is unavailable. No AI request was made by this catalogue action.' }); }
  };
  app.get('/api/jewellery/types',wrap((req,res)=>{catalogueCategory('jewellery',{jewelleryEnabled:config.jewelleryEnabled});res.json({types:jewelleryTypes,metals:jewelleryMetals,bangleSizes,tryOnAvailable:Boolean(config.jewelleryAvailable)});}));
  app.get('/api/garments', wrap((req, res, owner) => res.json(store.garments.browse(owner,{...req.query,limit:req.query.limit??200},req.catalogueOptions))));
  app.post('/api/garments/match', wrap(async (req, res, owner) => res.json(await store.garments.matches(owner, {...req.body,category:req.catalogueOptions.category},req.catalogueOptions))));
  app.post('/api/garments', wrap(async (req, res, owner) => {
    if (req.body?.storageConsent !== true) return res.status(400).json({ error: 'Confirm saving this product photo to the store account.' });
    const options={...req.catalogueOptions,...(req.catalogueOptions.category==='jewellery'?{guard:()=>{const current=accountUser(store,req);if(!current||current.id!==owner.id||current.user.id!==owner.user.id)throw Object.assign(new Error('The store session changed.'),{status:401});}}:{})};
    res.json(await store.garments.save(owner,{...req.body,category:req.catalogueOptions.category},options));
  }));
  app.get('/api/garments/:id', wrap((req, res, owner) => {const garment=store.garments.get(owner,req.params.id,req.catalogueOptions);res.json({garment,...(garment.category==='jewellery'?{suggestedView:chooseView(garment.garmentType,garment.attributes)}:{})});}));
  app.delete('/api/garments/:id', wrap((req, res, owner) => {
    if (!store.garments.remove(owner, req.params.id,req.catalogueOptions)) return res.status(404).json({ error: 'Garment not found.' });
    res.json({ ok: true });
  }));
  app.post('/api/garments/:id/overlay',wrap(async(req,res,owner)=>{
    if(req.catalogueOptions.category!=='jewellery')return res.status(400).json({error:'Choose the jewellery catalogue.'});
    if(!req.body||Object.keys(req.body).some(k=>!['overlayPng','overlayAnchor','storageConsent'].includes(k)))return res.status(400).json({error:'Use a transparent PNG and its anchor type only.'});
    if(req.body.storageConsent!==true)return res.status(400).json({error:'Confirm saving this cut-out to the catalogue.'});
    res.json(await saveOverlayAsset(store,owner,req.params.id,req.body,{guard:()=>{const latest=accountUser(store,req);if(!latest||latest.id!==owner.id||latest.user.id!==owner.user.id)throw Object.assign(new Error('The store session changed.'),{status:401});}}));
  }));
  app.post('/api/garments/:id/reuse/use',wrap(async(req,res,owner)=>{
    if(!validRequestId(req.body?.requestId))return res.status(400).json({error:'Use a fresh request ID to open a saved result.'});
    validateSession(store,owner,req.body);
    const context=await store.garments.context(owner,{...req.body,garmentId:req.params.id},config),result=store.garments.cached(owner,context);
    if(!result)return res.status(404).json({error:'The saved adaptation is no longer available. Check before generating; no AI request was made.'});
    recordTryon(store,owner,{...req.body,avatarId:context.avatarId,garmentId:context.garmentId},{reused:true});
    res.json({...result,garmentId:context.garmentId,reused:true});
  }));
  app.post('/api/garments/:id/reuse', wrap(async (req, res, owner) => {
    const context = await store.garments.context(owner, { ...req.body, garmentId: req.params.id }, config);
    const result = store.garments.cached(owner, context);
    res.json({ match: Boolean(result), ...(result || {}) });
  }));
  app.post('/api/garments/:id/results', wrap(async (req, res, owner) => res.json(await store.garments.saveResult(owner, req.params.id, req.body || {}))));
  app.delete('/api/garments/:id/results/:result', wrap((req, res, owner) => {
    if (!store.garments.removeResult(owner, req.params.id, req.params.result)) return res.status(404).json({ error: 'Saved adaptation not found.' });
    res.json({ ok: true });
  }));
}
