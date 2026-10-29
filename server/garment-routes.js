import { accountUser } from './accounts.js';

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
      await fn(req, res, owner);
    } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'The store catalogue is unavailable. No AI request was made by this catalogue action.' }); }
  };
  app.get('/api/garments', wrap((req, res, owner) => res.json({ garments: store.garments.list(owner) })));
  app.post('/api/garments/match', wrap(async (req, res, owner) => res.json(await store.garments.matches(owner, req.body || {}))));
  app.post('/api/garments', wrap(async (req, res, owner) => {
    if (req.body?.storageConsent !== true) return res.status(400).json({ error: 'Confirm saving this product photo to the store account.' });
    res.json(await store.garments.save(owner, req.body));
  }));
  app.get('/api/garments/:id', wrap((req, res, owner) => res.json({ garment: store.garments.get(owner, req.params.id) })));
  app.delete('/api/garments/:id', wrap((req, res, owner) => {
    if (!store.garments.remove(owner, req.params.id)) return res.status(404).json({ error: 'Garment not found.' });
    res.json({ ok: true });
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
