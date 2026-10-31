import {randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {ProviderError} from './provider-errors.js';
import {requireRole} from './tenancy.js';
import {installPaymentRoutes} from './payments.js';
const id=()=>randomBytes(16).toString('hex');
const pools=['ai','photo'];
export class BillingError extends Error {
  constructor(code,message,status=409){super(message);this.code=code;this.status=status;}
}
export class CreditsRequired extends BillingError {
  constructor(){super('credits_required','Buy credits or upgrade. Ask your store owner to open Billing.',402);}
}
export function validRequestId(value){return typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}
export function billingFailure(res,error){
  if(!(error instanceof BillingError))return false;
  res.status(error.status).json({error:error.message,code:error.code});return true;
}

export class BillingStore {
  constructor(db,{pilotCredits=process.env.TRYON_PILOT_CREDITS ?? '1000'}={}){
    if(!/^\d+$/.test(String(pilotCredits)) || !Number.isSafeInteger(Number(pilotCredits)) || Number(pilotCredits)>1_000_000)throw new Error('TRYON_PILOT_CREDITS must be an integer from 0 to 1000000.');
    this.db=db;this.pilotCredits=Number(pilotCredits);
    this.transaction(()=>{
      db.exec(`CREATE TABLE IF NOT EXISTS ledger (
        id TEXT PRIMARY KEY,org TEXT NOT NULL REFERENCES orgs(id),store TEXT,user TEXT,
        pool TEXT NOT NULL CHECK(pool IN ('ai','photo')),amount INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('grant_plan','grant_pack','grant_admin','trial','hold','commit','refund','expire')),
        ref TEXT NOT NULL,requestId TEXT,action TEXT,createdAt INTEGER NOT NULL,
        CHECK((kind='hold' AND amount=-1 AND requestId IS NOT NULL) OR
          (kind='commit' AND amount=0 AND requestId IS NULL) OR
          (kind='refund' AND amount=1 AND requestId IS NULL) OR
          (kind IN ('grant_plan','grant_pack','grant_admin','trial') AND amount>=0 AND requestId IS NULL) OR
          (kind='expire' AND amount<=0 AND requestId IS NULL)));
        CREATE INDEX IF NOT EXISTS ledger_balance ON ledger(org,pool);
        CREATE UNIQUE INDEX IF NOT EXISTS ledger_request ON ledger(org,requestId) WHERE requestId IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS ledger_terminal ON ledger(ref) WHERE kind IN ('commit','refund');
        CREATE UNIQUE INDEX IF NOT EXISTS ledger_grant ON ledger(org,pool,kind,ref) WHERE kind IN ('grant_plan','grant_pack','grant_admin','trial');
        CREATE TRIGGER IF NOT EXISTS ledger_immutable_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT,'Ledger entries are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS ledger_immutable_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT,'Ledger entries are immutable'); END;`);
      if(!db.prepare('PRAGMA table_info(orgs)').all().some(c=>c.name==='pastDueSince'))db.exec('ALTER TABLE orgs ADD COLUMN pastDueSince INTEGER');
      for(const org of db.prepare("SELECT id FROM orgs WHERE plan='pilot'").all())this.seedPilot(org.id);
    });
  }
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  seedPilot(org){
    // Called in the startup/registration transaction. The stable ref makes this
    // a one-time grant even when the configured starting amount changes later.
    this.db.prepare("INSERT OR IGNORE INTO ledger(id,org,pool,amount,kind,ref,createdAt) VALUES(?,?,'ai',?,'grant_admin','pilot-initial',?)").run(id(),org,this.pilotCredits,Date.now());
  }
  balance(org,pool='ai'){
    if(!pools.includes(pool))throw new BillingError('invalid_pool','Choose a credit pool.',400);
    return this.db.prepare('SELECT coalesce(sum(amount),0) AS n FROM ledger WHERE org=? AND pool=?').get(org,pool).n;
  }
  grant(org,pool,amount,kind='grant_admin',ref){
    if(!pools.includes(pool)||!Number.isSafeInteger(amount)||amount<0||amount>1_000_000||!['grant_plan','grant_pack','grant_admin','trial'].includes(kind)||typeof ref!=='string'||!ref||ref.length>200)throw new BillingError('invalid_grant','Use a valid credit grant.',400);
    return this.transaction(()=>this.recordGrant(org,pool,amount,kind,ref));
  }
  // Payment + ledger + invoice must commit atomically in the caller transaction.
  recordGrant(org,pool,amount,kind,ref){
    if(!this.db.isTransaction)throw new Error('Credit grants require a transaction.');
    if(!pools.includes(pool)||!Number.isSafeInteger(amount)||amount<0||amount>1_000_000||!['grant_plan','grant_pack','grant_admin','trial'].includes(kind)||typeof ref!=='string'||!ref||ref.length>200)throw new BillingError('invalid_grant','Use a valid credit grant.',400);
      const existing=this.db.prepare('SELECT id,amount FROM ledger WHERE org=? AND pool=? AND kind=? AND ref=?').get(org,pool,kind,ref);
      if(existing){if(existing.amount!==amount)throw new BillingError('grant_conflict','This credit grant has already been recorded.');return existing.id;}
      const key=id();this.db.prepare('INSERT INTO ledger(id,org,pool,amount,kind,ref,createdAt) VALUES(?,?,?,?,?,?,?)').run(key,org,pool,amount,kind,ref,Date.now());return key;
  }
  reserve({org,store,user,pool='ai',requestId,action=pool==='photo'?'catalogue':'avatar'}){
    if(!validRequestId(requestId))throw new BillingError('invalid_request_id','Update the app: each generation needs a UUID v4 requestId.',400);
    if(!pools.includes(pool)||!['avatar','tryon','catalogue'].includes(action))throw new BillingError('invalid_meter','Invalid generation action.',400);
    return this.transaction(()=>{
      const actor=this.db.prepare('SELECT m.role,u.disabled,s.org,o.status,o.pastDueSince FROM memberships m JOIN users u ON u.id=m.user JOIN stores s ON s.id=m.store JOIN orgs o ON o.id=s.org WHERE m.user=? AND m.store=?').get(user,store);
      if(!actor||actor.disabled||actor.org!==org)throw new BillingError('account_required','Sign in to an active store account.',401);
      if(actor.status==='suspended')throw new BillingError('account_suspended','This organisation is suspended. Contact your store owner.',403);
      if(actor.status==='past_due' && Date.now() >= (actor.pastDueSince||0)+3*24*3600000)throw new BillingError('subscription_past_due','Subscription payment is overdue. Ask the store owner to open Billing.',402);
      const previous=this.db.prepare('SELECT id FROM ledger WHERE org=? AND requestId=?').get(org,requestId.toLowerCase());
      if(previous)throw new BillingError('duplicate_request','This generation request was already submitted. Check the existing result before starting a new request.');
      if(this.balance(org,pool)<1)throw new CreditsRequired();
      const key=id();this.db.prepare("INSERT INTO ledger(id,org,store,user,pool,amount,kind,ref,requestId,action,createdAt) VALUES(?,?,?,?,?,-1,'hold',?,?,?,?)").run(key,org,store,user,pool,action,requestId.toLowerCase(),action,Date.now());return key;
    });
  }
  settle(holdId,kind,reason){
    return this.transaction(()=>{
      const hold=this.db.prepare("SELECT * FROM ledger WHERE id=? AND kind='hold'").get(holdId);
      if(!hold)throw new BillingError('invalid_hold','Generation credit hold not found.');
      const terminal=this.db.prepare("SELECT kind FROM ledger WHERE ref=? AND kind IN ('commit','refund')").get(holdId);
      if(terminal){if(terminal.kind===kind)return false;if(kind==='refund')return false;throw new BillingError('request_expired','This generation credit reservation expired. No image was delivered.');}
      this.db.prepare('INSERT INTO ledger(id,org,store,user,pool,amount,kind,ref,action,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id(),hold.org,hold.store,hold.user,hold.pool,kind==='refund'?1:0,kind,holdId,reason,Date.now());return true;
    });
  }
  commit(holdId){return this.settle(holdId,'commit','delivered');}
  refund(holdId,reason='failed'){return this.settle(holdId,'refund',reason);}
  sweep(now=Date.now()){
    const pending=this.db.prepare("SELECT h.id FROM ledger h WHERE h.kind='hold' AND h.createdAt<? AND NOT EXISTS (SELECT 1 FROM ledger t WHERE t.ref=h.id AND t.kind IN ('commit','refund'))").all(now-10*60*1000);
    let count=0;for(const hold of pending)if(this.refund(hold.id,'expired'))count++;return count;
  }
}

export async function trialWatermark(image){
  const match=typeof image==='string'&&/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  if(!match)throw new ProviderError('invalid_image');
  const source=Buffer.from(match[1],'base64');
  const meta=await sharp(source,{limitInputPixels:25_000_000}).metadata();
  const width=Math.min(meta.width,210),height=Math.min(meta.height,36);
  const overlay=Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="white" opacity="0.85"/><text x="50%" y="65%" text-anchor="middle" font-family="sans-serif" font-size="${Math.min(18,width/8)}" fill="#234b3a">Forme trial</text></svg>`);
  const result=await sharp(source,{limitInputPixels:25_000_000}).composite([{input:overlay,gravity:'southeast'}]).png().toBuffer();
  return `data:image/png;base64,${result.toString('base64')}`;
}
export async function meter(req,{billing,account,pool='ai',action},fn){
  // Ephemeral pilots have no organisation or ledger; their existing paid limits
  // remain in force. Account-backed deployments always meter the provider call.
  if(!billing)return fn();
  const hold=billing.reserve({org:account.org,store:account.id,user:account.user.id,pool,action,requestId:req.body.requestId});
  try{
    let image=await fn();
    if(typeof image!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image))throw new ProviderError('invalid_image');
    try { await sharp(Buffer.from(image.split(',')[1],'base64'),{limitInputPixels:25_000_000}).png().toBuffer(); } catch { throw new ProviderError('invalid_image'); }
    if(billing.db.prepare('SELECT status FROM orgs WHERE id=?').get(account.org)?.status==='trial')image=await trialWatermark(image);
    billing.commit(hold);return image;
  }catch(e){billing.refund(hold,'failed');throw e;}
}
export function installBillingRoutes(app,store,{requireUser,sameOrigin,wrap,payments}){
  installPaymentRoutes(app,payments,{requireUser,sameOrigin,wrap});
  app.get('/api/billing',requireUser,requireRole('owner'),wrap((req,res)=>{
    const org=store.db.prepare('SELECT plan,status FROM orgs WHERE id=?').get(req.account.org);
    res.json({...org,balances:{ai:store.billing.balance(req.account.org,'ai'),photo:store.billing.balance(req.account.org,'photo')}});
  }));
}
