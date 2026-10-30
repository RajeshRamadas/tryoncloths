import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import sharp from "sharp";
import { profiles, recommendProfile, validTemplateTone, DEFAULT_TEMPLATE_TONE } from "../src/profiles.js";
import { GarmentStore } from "./garment-store.js";
import { migrateTenancy, migrateUserSessions, storesForUser, storeMembership, requireRole } from "./tenancy.js";
import { installStaffRoutes } from "./staff.js";
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
    if (!this.db.prepare("PRAGMA table_info(avatars)").all().some(c=>c.name==="template_tone")) this.db.exec("ALTER TABLE avatars ADD COLUMN template_tone TEXT NOT NULL DEFAULT 'medium'");
    this.garments = new GarmentStore(this);
    try { migrateTenancy(this.db); migrateUserSessions(this.db); }
    catch (error) { this.db.close(); throw error; }
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
    try {
      this.db.exec("BEGIN IMMEDIATE");
      if (this.db.prepare("SELECT 1 FROM users WHERE email=?").get(email)) throw error("This email is already registered. Sign in to its store account.",409);
      const org = randomBytes(16).toString("hex"), user = randomBytes(16).toString("hex");
      this.db.prepare("INSERT INTO accounts VALUES(?,?,?,?,?)").run(account.id,email,name,salt,password);
      this.db.prepare("INSERT INTO orgs(id,name,billingEmail,plan,status,createdAt) VALUES(?,?,?,'pilot','active',?)").run(org,name,email,Date.now());
      this.db.prepare("INSERT INTO stores(id,org,name) VALUES(?,?,?)").run(account.id,org,name);
      this.db.prepare("INSERT INTO users(id,email,name,salt,password,createdAt) VALUES(?,?,?,?,?,?)").run(user,email,name,salt,password,Date.now());
      this.db.prepare("INSERT INTO memberships VALUES(?,?,'owner')").run(user,account.id);
      this.db.exec("COMMIT");
      return this.identity(user,account.id);
    }
    catch (e) { this.db.exec("ROLLBACK"); if (e.code?.includes("SQLITE_CONSTRAINT") || e.message?.includes("UNIQUE")) throw error("This email is already registered. Sign in to its store account.",409); throw e; }
  }
  async login(input) {
    const row = this.db.prepare("SELECT * FROM users WHERE email=?").get(emailValue(input.email));
    const password = typeof input.password === "string" && input.password.length <= 128 ? input.password : "";
    const hash = await scrypt(password, row?.salt || "forme-missing-account", 64);
    if (!row || row.disabled || !timingSafeEqual(hash, Buffer.from(row.password))) throw error("Email or password is incorrect.",401);
    const membership = storesForUser(this.db,row.id)[0];
    if (!membership) throw error("No store access is available for this user.",403);
    return this.identity(row.id,membership.id);
  }
  identity(userId, storeId) {
    const membership = storeMembership(this.db,userId,storeId);
    if (!membership) return null;
    const user = this.db.prepare("SELECT id,name,email FROM users WHERE id=? AND disabled=0").get(userId);
    return {id:membership.id,name:membership.name,email:user.email,
      user:{id:user.id,name:user.name,role:membership.role},org:membership.org};
  }
  session(account) {
    const identity = this.identity(account.user?.id,account.id);
    if (!identity) throw error("Store access is no longer available.",403);
    const token = randomBytes(32).toString("hex");
    this.db.prepare("DELETE FROM sessions WHERE expires <= ?").run(Date.now());
    this.db.prepare("INSERT INTO sessions(token,account,expires,user,store) VALUES(?,?,?,?,?)")
      .run(digest(token),identity.id,Date.now()+lifetime,identity.user.id,identity.id);
    return token;
  }
  user(token) {
    const session = this.db.prepare("SELECT * FROM sessions WHERE token=? AND expires>?").get(digest(token),Date.now());
    if (!session) return null;
    if (!session.user && !session.store) {
      const owner = this.db.prepare(`SELECT u.id FROM users u JOIN accounts a ON a.email=u.email
        JOIN memberships m ON m.user=u.id AND m.store=a.id
        WHERE a.id=? AND m.role='owner' AND u.disabled=0`).get(session.account);
      if (!owner) return null;
      this.db.prepare("UPDATE sessions SET user=?,store=? WHERE token=? AND user IS NULL AND store IS NULL")
        .run(owner.id,session.account,session.token);
      session.user=owner.id; session.store=session.account;
    }
    return this.identity(session.user,session.store);
  }
  switchStore(token, storeId) {
    const current = this.user(token);
    if (!current) throw error("Sign in to your store account.",401);
    if (typeof storeId !== "string") throw error("Choose a store.");
    const next = this.identity(current.user.id,storeId);
    if (!next) throw error("You do not have access to this store.",403);
    this.db.prepare("UPDATE sessions SET store=?,account=? WHERE token=?").run(storeId,storeId,digest(token));
    return next;
  }
  logout(token) { this.db.prepare("DELETE FROM sessions WHERE token=?").run(digest(token)); }
  async resetPassword(email, password) {
    if (typeof password !== "string" || password.length < 12 || password.length > 128) throw error("Use a password between 12 and 128 characters.");
    const user = this.db.prepare("SELECT id FROM users WHERE email=?").get(emailValue(email));
    if (!user) throw error("Account not found.",404);
    const salt = randomBytes(16).toString("hex"), hash = await scrypt(password,salt,64);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE users SET salt=?,password=? WHERE id=?").run(salt,hash,user.id);
      this.db.prepare("UPDATE accounts SET salt=?,password=? WHERE email=?").run(salt,hash,emailValue(email));
      this.db.prepare(`DELETE FROM sessions WHERE user=? OR (user IS NULL AND account IN
        (SELECT a.id FROM accounts a JOIN memberships m ON m.store=a.id
          WHERE a.email=? AND m.user=? AND m.role='owner'))`).run(user.id,emailValue(email),user.id);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  async save(account, input) {
    const { profileId, heightCm, weightKg } = input;
    const templateTone = input.templateTone ?? DEFAULT_TEMPLATE_TONE;
    if (!validTemplateTone(templateTone)) throw error('Choose an available template skin tone.');
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length>60 || !profiles.some(p=>p.id===profileId) || !recommendProfile(heightCm,weightKg,profiles.find(p=>p.id===profileId)?.body) || !["generated","imported"].includes(input.source)) throw error("Use a name, body profile and valid measurements.");
    const {image, thumbnail} = await savedImage(input.image);
    const id = digest(image), savedAt = Date.now();
    const exists = this.db.prepare("SELECT id FROM avatars WHERE account=? AND id=?").get(account.id,id);
    const count = this.db.prepare("SELECT count(*) AS total FROM avatars WHERE account=?").get(account.id).total;
    if(!exists && count>=100) throw error("Your account holds up to 100 avatars. Delete one before adding another.",409);
    this.db.prepare(`INSERT INTO avatars(id,account,name,profileId,heightCm,weightKg,source,savedAt,image,thumbnail,body_type,template_tone) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account,id) DO UPDATE SET name=excluded.name, profileId=excluded.profileId,heightCm=excluded.heightCm,weightKg=excluded.weightKg,source=excluded.source,savedAt=excluded.savedAt,body_type=excluded.body_type,template_tone=excluded.template_tone`).run(id,account.id,name,profileId,heightCm,weightKg,input.source,savedAt,image,thumbnail,profiles.find(p=>p.id===profileId).body,templateTone);
    return {id,savedAt};
  }
  list(account) {
    return this.db.prepare("SELECT id,name,profileId,body_type AS bodyType,template_tone AS templateTone,heightCm,weightKg,source,savedAt,thumbnail,(SELECT count(*) FROM looks l WHERE l.account=avatars.account AND l.avatarId=avatars.id) AS looksCount FROM avatars WHERE account=? ORDER BY savedAt DESC").all(account.id).map(row=>({...row,thumbnail:`data:image/png;base64,${Buffer.from(row.thumbnail).toString("base64")}`}));
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
    this.db.prepare(`INSERT INTO looks(id,account,avatarId,name,garments,image,thumbnail,savedAt) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(account,id) DO UPDATE SET avatarId=excluded.avatarId,name=excluded.name,garments=excluded.garments,savedAt=excluded.savedAt`).run(id,account.id,input.avatarId,name,JSON.stringify(input.garments),image,thumbnail,savedAt);
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
export function installAccountRoutes(app, store, { production=false, allowSignup=true, sendMail, publicUrl }={}) {
  const attempts = new Map(); let hashes=0;
  const cookie = (res,value,maxAge=lifetime) => res.cookie(cookieName,value,{httpOnly:true,secure:production,sameSite:"strict",path:"/",maxAge});
  const wrap = fn => async(req,res) => { try { await fn(req,res); } catch(e) { res.status(e.status || 500).json({error:e.status ? e.message : "Account storage is unavailable. Please try again; no generation request was retried."}); } };
  const sameOrigin = (req,res,next) => {
    try { const origin=new URL(req.get("origin")); if(origin.host===req.get("host") && origin.protocol===`${req.protocol}:`)return next(); } catch {}
    return res.status(403).json({error:"Open account actions from this studio website."});
  };
  const requireUser = (req,res,next) => { req.account=accountUser(store,req); if(!req.account)return res.status(401).json({error:"Sign in to your store account."}); next(); };
  const response = account => ({account,user:account?.user || null,role:account?.user.role || null,
    stores:account ? storesForUser(store.db,account.user.id) : []});
  app.get("/api/account",wrap((req,res)=>res.json({enabled:Boolean(store),signupAllowed:Boolean(store&&allowSignup),...response(accountUser(store,req))})));
  if(!store) return;
  installStaffRoutes(app,store,{sameOrigin,requireUser,wrap,production,sendMail,publicUrl});
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
      res.json(response(account));
    } finally { hashes--; }
  }));
  app.post("/api/auth/switch-store",sameOrigin,requireUser,requireRole("owner","manager","staff"),wrap((req,res)=>{
    res.json(response(store.switchStore(token(req),req.body?.storeId)));
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
