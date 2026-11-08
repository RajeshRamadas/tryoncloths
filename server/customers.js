import {validateMeasurements} from './measurements.js';
import { randomBytes } from 'node:crypto';
import { requireRole } from './tenancy.js';

const fail = (message, status = 400) => Object.assign(new Error(message), {status});
export function normalizePhone(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^\+?[\d\s().-]+$/.test(value.trim())) throw fail('Enter a mobile number, including the country code for numbers outside India.');
  let digits = value.replace(/\D/g, '');
  if (!value.trim().startsWith('+')) {
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 10) digits = '91' + digits;
    else if (!(digits.length === 12 && digits.startsWith('91'))) throw fail('Use 10 digits for India, or include + and the country code.');
  }
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw fail('Enter a valid mobile number.');
  return '+' + digits;
}
function searchPrefix(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^\+?[\d\s().-]+$/.test(value.trim())) throw fail('Enter at least 3 digits of the mobile number.');
  let digits = value.replace(/\D/g, '');
  if (digits.length > 10) digits = normalizePhone(value).slice(-10);
  if (digits.length < 3 || digits.length > 10) throw fail('Enter at least 3 digits of the mobile number.');
  return digits;
}
function fields(input, previous) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Enter customer details.');
  const rawName = input.name ?? previous?.name;
  if(input.measurements!==undefined&&input.measurements!==null&&(typeof input.measurements!=='object'||Array.isArray(input.measurements)))throw fail('Use an object of customer measurements.');
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  const notes = input.notes ?? previous?.notes ?? '';
  if (!name || name.length > 80 || typeof notes !== 'string' || notes.length > 2000) throw fail('Use a customer name up to 80 characters and notes up to 2,000 characters.');
  const phoneE164 = normalizePhone(input.phoneE164 ?? previous?.phoneE164);
  const marketingOptIn = input.marketingOptIn ?? previous?.marketingOptIn ?? false;
  if (typeof marketingOptIn !== 'boolean') throw fail('Choose whether the customer agrees to marketing.');
  const optInSource = marketingOptIn ? (input.optInSource ?? previous?.optInSource ?? 'in_store') : null;
  if (optInSource !== null && !['in_store', 'whatsapp'].includes(optInSource)) throw fail('Choose a valid consent source.');
  // Timestamps are server-owned. Opting out clears the consent record.
  const optInAt = marketingOptIn ? (previous?.marketingOptIn && previous.optInSource === optInSource ? previous.optInAt : Date.now()) : null;
  return {name, phoneE164, notes:notes.trim(), marketingOptIn, optInAt, optInSource,
    measurements:validateMeasurements(input.measurements === undefined ? previous?.measurements : input.measurements===null ? null : {...previous?.measurements,...input.measurements})};
}
function customer(row) {
  if (!row) return null;
  const {measurementsJson, phoneSearch, ...rest} = row;
  return {...rest, marketingOptIn:Boolean(row.marketingOptIn), measurements:measurementsJson ? JSON.parse(measurementsJson) : null};
}

export class CustomerStore {
  constructor(db) {
    this.db = db;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY, store TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        name TEXT NOT NULL, phoneE164 TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
        marketingOptIn INTEGER NOT NULL DEFAULT 0 CHECK(marketingOptIn IN (0,1)),
        optInAt INTEGER, optInSource TEXT CHECK(optInSource IN ('in_store','whatsapp')),
        measurementsJson TEXT, createdAt INTEGER NOT NULL,
        phoneSearch TEXT GENERATED ALWAYS AS (substr(substr(phoneE164,2),-10)) STORED,
        UNIQUE(store,phoneE164), UNIQUE(store,id));
        CREATE INDEX IF NOT EXISTS customers_phone ON customers(store,phoneSearch);
        CREATE INDEX IF NOT EXISTS avatars_customer ON avatars(account,customer);
        CREATE TRIGGER IF NOT EXISTS avatars_customer_insert BEFORE INSERT ON avatars
          WHEN NEW.customer IS NOT NULL AND NOT EXISTS(SELECT 1 FROM customers WHERE id=NEW.customer AND store=NEW.account)
          BEGIN SELECT RAISE(ABORT,'Customer does not belong to this store'); END;
        CREATE TRIGGER IF NOT EXISTS avatars_customer_update BEFORE UPDATE OF customer,account ON avatars
          WHEN NEW.customer IS NOT NULL AND NOT EXISTS(SELECT 1 FROM customers WHERE id=NEW.customer AND store=NEW.account)
          BEGIN SELECT RAISE(ABORT,'Customer does not belong to this store'); END;
        CREATE TRIGGER IF NOT EXISTS customers_erase BEFORE DELETE ON customers
          BEGIN DELETE FROM avatars WHERE account=OLD.store AND customer=OLD.id; END;
        -- C8 will add sharing endpoints. Establish its cascade now so erasure
        -- already covers shared looks; no public links are created by C7.
        CREATE TABLE IF NOT EXISTS share_links (
          tokenHash TEXT PRIMARY KEY, store TEXT NOT NULL, look TEXT NOT NULL,
          expiresAt INTEGER NOT NULL, revokedAt INTEGER, views INTEGER NOT NULL DEFAULT 0,
          createdBy TEXT REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY(store,look) REFERENCES looks(account,id) ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS share_links_look ON share_links(store,look);`);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  get(account, id) {
    if (typeof id !== 'string') throw fail('Customer not found.',404);
    const row = customer(this.db.prepare('SELECT * FROM customers WHERE store=? AND id=?').get(account.id,id));
    if (!row) throw fail('Customer not found.',404);
    return row;
  }
  requireOptional(account, id) { if (id !== undefined && id !== null) this.get(account,id); }
  list(account, phone, offset = 0) {
    if (!/^\d+$/.test(String(offset)) || Number(offset)>100000) throw fail('Use a valid customer page.');
    if (phone !== undefined) {
      const prefix = searchPrefix(phone);
      return this.db.prepare('SELECT * FROM customers WHERE store=? AND phoneSearch>=? AND phoneSearch<? ORDER BY phoneSearch,id LIMIT 50 OFFSET ?').all(account.id,prefix,prefix+':',Number(offset)).map(customer);
    }
    return this.db.prepare('SELECT * FROM customers WHERE store=? ORDER BY createdAt DESC,id LIMIT 50 OFFSET ?').all(account.id,Number(offset)).map(customer);
  }
  save(account, input, id) {
    const previous = id === undefined ? null : this.get(account,id);
    const value = fields(input,previous);
    if(input.whatsappConsent!==undefined && typeof input.whatsappConsent!=='boolean')throw fail('Choose whether the customer agrees to receive outfits on WhatsApp.');
    const whatsappAt=input.whatsappConsent===undefined ? previous?.whatsappConsentAt ?? null : input.whatsappConsent ? previous?.whatsappConsentAt || Date.now() : null;
    const whatsappSource=whatsappAt?'in_store':null;
    const customerId = previous?.id || randomBytes(16).toString('hex');
    try {
      if (previous) this.db.prepare('UPDATE customers SET name=?,phoneE164=?,notes=?,marketingOptIn=?,optInAt=?,optInSource=?,measurementsJson=?,whatsappConsentAt=?,whatsappConsentSource=? WHERE store=? AND id=?')
        .run(value.name,value.phoneE164,value.notes,Number(value.marketingOptIn),value.optInAt,value.optInSource,JSON.stringify(value.measurements),whatsappAt,whatsappSource,account.id,customerId);
      else this.db.prepare('INSERT INTO customers(id,store,name,phoneE164,notes,marketingOptIn,optInAt,optInSource,measurementsJson,createdAt,whatsappConsentAt,whatsappConsentSource) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(customerId,account.id,value.name,value.phoneE164,value.notes,Number(value.marketingOptIn),value.optInAt,value.optInSource,JSON.stringify(value.measurements),Date.now(),whatsappAt,whatsappSource);
    } catch (e) {
      if (e.message?.includes('UNIQUE constraint failed: customers.store, customers.phoneE164')) throw fail('This mobile number already has a customer in this store. Find and select that customer.',409);
      throw e;
    }
    return this.get(account,customerId);
  }
  remove(account,id) {
    this.get(account,id);
    this.onRemove?.(account,id);
    // One SQLite statement includes the avatar trigger and all FK cascades.
    this.db.prepare('DELETE FROM customers WHERE store=? AND id=?').run(account.id,id);
  }
}

export function installCustomerRoutes(app,store,{requireUser,sameOrigin,wrap}) {
  const roles = requireRole('owner','manager','staff');
  const customers = store.customers;
  app.get('/api/customers',requireUser,roles,wrap((req,res)=>res.json({customers:customers.list(req.account,undefined,req.query.offset)})));
  app.get('/api/customers/search',requireUser,roles,wrap((req,res)=>res.json({customers:customers.list(req.account,req.query.phone ?? '',req.query.offset)})));
  app.get('/api/customers/:id',requireUser,roles,wrap((req,res)=>res.json({customer:customers.get(req.account,req.params.id)})));
  app.post('/api/customers',sameOrigin,requireUser,roles,wrap((req,res)=>res.status(201).json({customer:customers.save(req.account,req.body)})));
  app.patch('/api/customers/:id',sameOrigin,requireUser,roles,wrap((req,res)=>res.json({customer:customers.save(req.account,req.body,req.params.id)})));
  app.delete('/api/customers/:id',sameOrigin,requireUser,roles,wrap((req,res)=>{customers.remove(req.account,req.params.id);res.json({ok:true});}));
}
