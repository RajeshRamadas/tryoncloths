import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import sharp from "sharp";
import { profiles, recommendProfile } from "../src/profiles.js";
const scrypt = promisify(scryptCallback);
const digest = value => createHash("sha256").update(value).digest("hex");
const cookieName = "forme_session";
const lifetime = 30 * 24 * 3600 * 1000;
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const emailValue = value => typeof value === "string" ? value.trim().toLowerCase() : "";

async function savedImage(value) {
    if (typeof value !== "string" || value.length > 14_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw error("Use an avatar PNG under 10 MB.");
    let image, thumbnail;
    try {
      const source = sharp(Buffer.from(value.split(",")[1],"base64"), {limitInputPixels:16_000_000});
      const meta = await source.metadata();
      if(meta.format!=="png" || meta.width<128 || meta.height<256 || meta.width>=meta.height) throw new Error();
      image = await source.rotate().png().toBuffer();
      if(image.length>10*1024*1024) throw new Error();
      thumbnail = await sharp(image).resize({height:160}).png().toBuffer();
    } catch { throw error("Use a valid full-body portrait PNG under 10 MB and at most 16 megapixels."); }
    return {image, thumbnail};
}

export class AccountStore {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const filename = path.join(directory, "accounts.sqlite");
    this.db = new DatabaseSync(filename);
    chmodSync(filename, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL, password BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS avatars(id TEXT NOT NULL, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, name TEXT NOT NULL, profileId TEXT NOT NULL, heightCm REAL NOT NULL, weightKg REAL NOT NULL, source TEXT NOT NULL, savedAt INTEGER NOT NULL, image BLOB NOT NULL, thumbnail BLOB NOT NULL, PRIMARY KEY(account,id));
      CREATE TABLE IF NOT EXISTS looks(id TEXT NOT NULL, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, avatarId TEXT NOT NULL, name TEXT NOT NULL, garments TEXT NOT NULL, image BLOB NOT NULL, thumbnail BLOB NOT NULL, savedAt INTEGER NOT NULL, PRIMARY KEY(account,id), FOREIGN KEY(account,avatarId) REFERENCES avatars(account,id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS looks_avatar ON looks(account,avatarId);`);
    if (!this.db.prepare("PRAGMA table_info(avatars)").all().some(c=>c.name==="body_type")) this.db.exec("ALTER TABLE avatars ADD COLUMN body_type TEXT NOT NULL DEFAULT 'male'");
  }
  close() { this.db.close(); }
  async register(input) {
    const email = emailValue(input.email);
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 80)
      throw error("Enter a store name and valid email address.");
    if (typeof input.password !== "string" || input.password.length < 12 || input.password.length > 128)
      throw error("Use a password between 12 and 128 characters.");
    const salt = randomBytes(16).toString("hex");
    const password = await scrypt(input.password, salt, 64);
    const account = { id: randomBytes(16).toString("hex"), email, name };
    try { this.db.prepare("INSERT INTO accounts VALUES(?,?,?,?,?)").run(account.id,email,name,salt,password); }
    catch (e) { if (e.code?.includes("SQLITE_CONSTRAINT") || e.message?.includes("UNIQUE")) throw error("This email is already registered. Sign in to its store account.",409); throw e; }
    return account;
  }
  async login(input) {
    const row = this.db.prepare("SELECT * FROM accounts WHERE email=?").get(emailValue(input.email));
    const password = typeof input.password === "string" && input.password.length <= 128 ? input.password : "";
    // Hash even unknown accounts to avoid a cheap account-existence timing test.
    const hash = await scrypt(password, row?.salt || "forme-missing-account", 64);
    if (!row || !timingSafeEqual(hash, Buffer.from(row.password))) throw error("Email or password is incorrect.",401);
    return { id: row.id, email: row.email, name: row.name };
  }
  session(account) {
    const token = randomBytes(32).toString("hex");
    this.db.prepare("DELETE FROM sessions WHERE expires <= ?").run(Date.now());
    this.db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(digest(token),account.id,Date.now()+lifetime);
    return token;
  }
  user(token) {
    return this.db.prepare("SELECT a.id,a.email,a.name FROM sessions s JOIN accounts a ON a.id=s.account WHERE s.token=? AND s.expires>?").get(digest(token),Date.now()) || null;
  }
  logout(token) { this.db.prepare("DELETE FROM sessions WHERE token=?").run(digest(token)); }
  async resetPassword(email, password) {
    if (typeof password !== "string" || password.length < 12 || password.length > 128) throw error("Use a password between 12 and 128 characters.");
    const account = this.db.prepare("SELECT id FROM accounts WHERE email=?").get(emailValue(email));
    if (!account) throw error("Account not found.",404);
    const salt = randomBytes(16).toString("hex"), hash = await scrypt(password,salt,64);
    this.db.prepare("UPDATE accounts SET salt=?,password=? WHERE id=?").run(salt,hash,account.id);
    this.db.prepare("DELETE FROM sessions WHERE account=?").run(account.id);
  }
  async save(account, input) {
    const { profileId, heightCm, weightKg } = input;
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length>60 || !profiles.some(p=>p.id===profileId) || !recommendProfile(heightCm,weightKg,profiles.find(p=>p.id===profileId)?.body) || !["generated","imported"].includes(input.source)) throw error("Use a name, body profile and valid measurements.");
    const {image, thumbnail} = await savedImage(input.image);
    const id = digest(image), savedAt = Date.now();
    const exists = this.db.prepare("SELECT id FROM avatars WHERE account=? AND id=?").get(account.id,id);
    const count = this.db.prepare("SELECT count(*) AS total FROM avatars WHERE account=?").get(account.id).total;
    if(!exists && count>=100) throw error("Your account holds up to 100 avatars. Delete one before adding another.",409);
    this.db.prepare(`INSERT INTO avatars(id,account,name,profileId,heightCm,weightKg,source,savedAt,image,thumbnail,body_type) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account,id) DO UPDATE SET name=excluded.name, profileId=excluded.profileId,heightCm=excluded.heightCm,weightKg=excluded.weightKg,source=excluded.source,savedAt=excluded.savedAt,body_type=excluded.body_type`).run(id,account.id,name,profileId,heightCm,weightKg,input.source,savedAt,image,thumbnail,profiles.find(p=>p.id===profileId).body);
    return {id,savedAt};
  }
  list(account) {
    return this.db.prepare("SELECT id,name,profileId,body_type AS bodyType,heightCm,weightKg,source,savedAt,thumbnail,(SELECT count(*) FROM looks l WHERE l.account=avatars.account AND l.avatarId=avatars.id) AS looksCount FROM avatars WHERE account=? ORDER BY savedAt DESC").all(account.id).map(row=>({...row,thumbnail:`data:image/png;base64,${Buffer.from(row.thumbnail).toString("base64")}`}));
  }
  async saveLook(account, input) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > 60 || !Array.isArray(input.garments) || input.garments.length > 10 || input.garments.some(x => typeof x !== "string" || !x.trim() || x.length > 120)) throw error("Use a look name and up to 10 garment labels of at most 120 characters.");
    this.requireAvatar(account, input.avatarId);
    const {image, thumbnail} = await savedImage(input.image);
    // Recheck after decoding: the avatar may have been deleted meanwhile.
    this.requireAvatar(account, input.avatarId);
    const id = digest(image), savedAt = Date.now();
    const exists = this.db.prepare("SELECT id FROM looks WHERE account=? AND id=?").get(account.id,id);
    if (!exists && this.db.prepare("SELECT count(*) AS total FROM looks WHERE account=?").get(account.id).total >= 200) throw error("Your account holds up to 200 looks. Delete one before adding another.",409);
    this.db.prepare(`INSERT INTO looks VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(account,id) DO UPDATE SET avatarId=excluded.avatarId,name=excluded.name,garments=excluded.garments,savedAt=excluded.savedAt`).run(id,account.id,input.avatarId,name,JSON.stringify(input.garments),image,thumbnail,savedAt);
    return {id,avatarId:input.avatarId,savedAt};
  }
  requireAvatar(account,id) {
    if (typeof id !== "string" || !this.db.prepare("SELECT id FROM avatars WHERE account=? AND id=?").get(account.id,id)) throw error("Avatar not found.",404);
  }
  listLooks(account,avatarId) {
    if (avatarId !== undefined) this.requireAvatar(account,avatarId);
    const rows = avatarId === undefined
      ? this.db.prepare("SELECT id,avatarId,name,garments,thumbnail,savedAt FROM looks WHERE account=? ORDER BY savedAt DESC").all(account.id)
      : this.db.prepare("SELECT id,avatarId,name,garments,thumbnail,savedAt FROM looks WHERE account=? AND avatarId=? ORDER BY savedAt DESC").all(account.id,avatarId);
    return rows.map(row=>({...row,garments:JSON.parse(row.garments),thumbnail:`data:image/png;base64,${Buffer.from(row.thumbnail).toString("base64")}`}));
  }
  lookImage(account,id) { const row=this.db.prepare("SELECT image FROM looks WHERE account=? AND id=?").get(account.id,id);return row?Buffer.from(row.image):null; }
  removeLook(account,id) { return this.db.prepare("DELETE FROM looks WHERE account=? AND id=?").run(account.id,id).changes>0; }
  image(account,id) { const row=this.db.prepare("SELECT image FROM avatars WHERE account=? AND id=?").get(account.id,id); return row ? Buffer.from(row.image) : null; }
  remove(account,id) { return this.db.prepare("DELETE FROM avatars WHERE account=? AND id=?").run(account.id,id).changes>0; }
}

function token(req) { return (req.get("cookie") || "").split(";").map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1) || ""; }
export function accountUser(store,req) { return store?.user(token(req)) || null; }
export function installAccountRoutes(app, store, { production=false, allowSignup=true }={}) {
  const attempts = new Map(); let hashes=0;
  const cookie = (res,value,maxAge=lifetime) => res.cookie(cookieName,value,{httpOnly:true,secure:production,sameSite:"strict",path:"/",maxAge});
  const wrap = fn => async(req,res) => { try { await fn(req,res); } catch(e) { res.status(e.status || 500).json({error:e.status ? e.message : "Account storage is unavailable. Please try again; no generation request was retried."}); } };
  const sameOrigin = (req,res,next) => {
    try { const origin=new URL(req.get("origin")); if(origin.host===req.get("host") && origin.protocol===`${req.protocol}:`)return next(); } catch {}
    return res.status(403).json({error:"Open account actions from this studio website."});
  };
  const requireUser = (req,res,next) => { req.account=accountUser(store,req); if(!req.account)return res.status(401).json({error:"Sign in to your store account."}); next(); };
  app.get("/api/account",wrap((req,res)=>res.json({enabled:Boolean(store),signupAllowed:Boolean(store&&allowSignup),account:accountUser(store,req)})));
  if(!store) return;
  for(const action of ["register","login"])app.post(`/api/account/${action}`,sameOrigin,wrap(async(req,res)=>{
    const key=`${action}:${req.ip}`, now=Date.now();
    let entry=attempts.get(key);
    if(!entry || now-entry.started>15*60*1000)entry={started:now,count:0};
    if(entry.count>=10 || hashes>=2)throw error("Too many sign-in attempts. Please wait before trying again.",429);
    entry.count++; if(attempts.size>2000)attempts.delete(attempts.keys().next().value); attempts.set(key,entry);
    if(action==="register"&&!allowSignup)throw error("Account registration is disabled. Ask the store administrator for access.",403);
    hashes++;
    try {
      const account=await store[action](req.body || {});
      store.logout(token(req)); cookie(res,store.session(account));
      res.json({account});
    } finally { hashes--; }
  }));
  app.post("/api/account/logout",sameOrigin,wrap((req,res)=>{ store.logout(token(req)); cookie(res,"",0);res.json({ok:true}); }));
  app.get("/api/looks",requireUser,wrap((req,res)=>res.json({looks:store.listLooks(req.account,req.query.avatar)})));
  app.get("/api/looks/:id/image",requireUser,wrap((req,res)=>{
    const image=store.lookImage(req.account,req.params.id);if(!image)throw error("Look not found.",404);res.type("png").send(image);
  }));
  app.post("/api/looks",sameOrigin,requireUser,wrap(async(req,res)=>{
    if(req.body?.storageConsent!==true)throw error("Confirm customer agreement before saving this look to the store account.");
    res.json(await store.saveLook(req.account,req.body));
  }));
  app.delete("/api/looks/:id",sameOrigin,requireUser,wrap((req,res)=>{
    if(!store.removeLook(req.account,req.params.id))throw error("Look not found.",404);res.json({ok:true});
  }));
  app.get("/api/avatars",requireUser,wrap((req,res)=>res.json({avatars:store.list(req.account)})));
  app.get("/api/avatars/:id/image",requireUser,wrap((req,res)=>{
    const image=store.image(req.account,req.params.id);if(!image)throw error("Avatar not found.",404);res.type("png").send(image);
  }));
  app.post("/api/avatars",sameOrigin,requireUser,wrap(async(req,res)=>{
    if(req.body.storageConsent!==true)throw error("Confirm customer agreement before saving to the store account.");
    res.json(await store.save(req.account,req.body));
  }));
  app.delete("/api/avatars/:id",sameOrigin,requireUser,wrap((req,res)=>{
    if(!store.remove(req.account,req.params.id))throw error("Avatar not found.",404);res.json({ok:true});
  }));
}
