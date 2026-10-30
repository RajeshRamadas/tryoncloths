import {randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {requireRole,storeMembership} from './tenancy.js';
import {sendMail as defaultSendMail} from './mailer.js';
const scrypt=promisify(scryptCallback);
const digest=value=>createHash('sha256').update(value).digest('hex');
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const roles=['owner','manager','staff'];
const escape=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function managedStore(db,actor,id=actor.id) {
  if (typeof id!=='string') throw error('Choose a store.');
  const target=storeMembership(db,actor.user.id,id);
  if (!target || target.org!==actor.org || (id!==actor.id && actor.user.role!=='owner') ||
      !['owner','manager'].includes(target.role)) throw error('You cannot manage staff for this store.',403);
  return target;
}
function activeOwners(db,store) {
  return db.prepare("SELECT count(*) AS n FROM memberships m JOIN users u ON u.id=m.user WHERE m.store=? AND m.role='owner' AND u.disabled=0").get(store).n;
}
function validInvite(db,token) {
  if (typeof token!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw error('This invitation is invalid or expired.',400);
  const invite=db.prepare('SELECT * FROM invites WHERE tokenHash=? AND acceptedAt IS NULL AND expiresAt>?').get(digest(token),Date.now());
  if (!invite) throw error('This invitation is invalid, expired or already used.',400);
  return invite;
}

export function installStaffRoutes(app,store,{sameOrigin,requireUser,wrap,sendMail=defaultSendMail,
  publicUrl=process.env.TRYON_PUBLIC_URL,production=false}={}) {
  const db=store.db, attempts=new Map();let hashes=0;
  const limit=(key,max)=>{
    const now=Date.now();let entry=attempts.get(key);
    if (!entry || now-entry.start>15*60*1000) entry={start:now,count:0};
    if (entry.count>=max) throw error('Too many staff account requests. Please wait before trying again.',429);
    entry.count++;if(attempts.size>=2000)attempts.delete(attempts.keys().next().value);attempts.set(key,entry);
  };
  app.post('/api/invites',sameOrigin,requireUser,requireRole('owner','manager'),wrap(async(req,res)=>{
    const actor=req.account,target=managedStore(db,actor,req.body?.storeId ?? actor.id);
    const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
    const role=req.body?.role;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || !roles.includes(role)) throw error('Enter a valid email and staff role.');
    if (target.role==='manager' && role!=='staff') throw error('Managers may invite staff only.',403);
    if (db.prepare('SELECT 1 FROM users u JOIN memberships m ON m.user=u.id WHERE u.email=? AND m.store=?').get(email,target.id)) throw error('This user already belongs to this store. Update their role in Staff.',409);
    let url;
    try {url=new URL(publicUrl);if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||
      (url.protocol!=='https:' && (production||url.protocol!=='http:')))throw new Error();}
    catch {throw error('Configure TRYON_PUBLIC_URL with the studio website origin before inviting staff.',503);}
    limit(`invite:${actor.user.id}`,20);
    const token=randomBytes(32).toString('base64url'),tokenHash=digest(token),expiresAt=Date.now()+7*24*3600*1000;
    db.prepare('INSERT INTO invites(tokenHash,org,store,role,email,expiresAt) VALUES(?,?,?,?,?,?)').run(tokenHash,target.org,target.id,role,email,expiresAt);
    const link=`${url.origin}/invite#${token}`;
    try {await sendMail({to:email,subject:'Your Forme staff invitation',
      text:`You have been invited to ${target.name} as ${role}. Open ${link} within 7 days. New users choose a password. Existing users must enter their current Forme password. If you did not expect this invitation, ignore it.`,
      html:`<p>You have been invited to ${escape(target.name)} as ${role}.</p><p><a href="${escape(link)}">Accept your invitation</a> within 7 days.</p><p>New users choose a password. Existing users must enter their current Forme password. If you did not expect this invitation, ignore it.</p>`});}
    catch(e) {db.prepare('DELETE FROM invites WHERE tokenHash=? AND acceptedAt IS NULL').run(tokenHash);throw e.status?e:error('Invitation email could not be delivered. Please try again later.',503);}
    res.json({ok:true,expiresAt});
  }));
  // Possession of the emailed token authorizes a new membership, never a reset of
  // an existing account's password. Existing users prove knowledge of that password.
  app.post('/api/invites/accept',sameOrigin,wrap(async(req,res)=>{
    limit(`accept:${req.ip}`,10);
    if (hashes>=2) throw error('Too many staff account requests. Please wait before trying again.',429);
    const {token,name,password}=req.body || {};
    const invite=validInvite(db,token);
    if (typeof name!=='string'||!name.trim()||name.trim().length>80||typeof password!=='string'||password.length<12||password.length>128) throw error('Enter your name and a password between 12 and 128 characters.');
    const existing=db.prepare('SELECT * FROM users WHERE email=?').get(invite.email);
    hashes++;
    try {
      const salt=existing?.salt || randomBytes(16).toString('hex');
      const hash=await scrypt(password,salt,64);
      if (existing && (existing.disabled || !timingSafeEqual(hash,Buffer.from(existing.password)))) throw error('Existing users must use their current Forme password. Ask an owner if access is disabled.',403);
      db.exec('BEGIN IMMEDIATE');
      try {
        const current=validInvite(db,token);
        const user=db.prepare('SELECT * FROM users WHERE email=?').get(current.email);
        // Recheck credential/account changes made while scrypt was running.
        if (user && (!existing || user.id!==existing.id || user.disabled || user.salt!==salt || !timingSafeEqual(hash,Buffer.from(user.password)))) throw error('Account access changed. Please try again.',409);
        const userId=user?.id || randomBytes(16).toString('hex');
        if (db.prepare('SELECT 1 FROM memberships WHERE user=? AND store=?').get(userId,current.store)) throw error('This user already belongs to this store.',409);
        if (!user) db.prepare('INSERT INTO users(id,email,name,salt,password,createdAt) VALUES(?,?,?,?,?,?)').run(userId,current.email,name.trim(),salt,hash,Date.now());
        db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(userId,current.store,current.role);
        db.prepare('UPDATE invites SET acceptedAt=? WHERE tokenHash=?').run(Date.now(),current.tokenHash);
        db.exec('COMMIT');
      } catch(e) {db.exec('ROLLBACK');throw e;}
      res.json({ok:true});
    } finally {hashes--;}
  }));
  app.get('/api/staff',requireUser,requireRole('owner','manager'),wrap((req,res)=>{
    const target=managedStore(db,req.account,req.query.storeId ?? req.account.id);
    const staff=db.prepare('SELECT u.id,u.name,u.email,u.disabled,m.role FROM memberships m JOIN users u ON u.id=m.user WHERE m.store=? ORDER BY u.name,u.id').all(target.id);
    res.json({staff});
  }));
  app.patch('/api/staff/:user',sameOrigin,requireUser,requireRole('owner','manager'),wrap((req,res)=>{
    const target=managedStore(db,req.account,req.body?.storeId ?? req.account.id);
    const input=req.body || {};
    if ((input.role===undefined&&input.disabled===undefined) || (input.role!==undefined&&!roles.includes(input.role)) ||
      (input.disabled!==undefined&&typeof input.disabled!=='boolean')) throw error('Choose a valid role or enabled state.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const member=db.prepare('SELECT u.id,u.disabled,m.role FROM users u JOIN memberships m ON m.user=u.id WHERE u.id=? AND m.store=?').get(req.params.user,target.id);
      if (!member) throw error('Staff member not found.',404);
      if (target.role==='manager' && (member.role!=='staff' || (input.role!==undefined&&input.role!=='staff'))) throw error('Managers may manage staff only.',403);
      if (input.role!==undefined && member.role==='owner' && input.role!=='owner' && !member.disabled && activeOwners(db,target.id)<=1) throw error('The last active owner cannot be demoted.',409);
      if (input.disabled!==undefined && Number(input.disabled)!==member.disabled) {
        // disabled is global: authority over one store cannot disable another
        // organisation's user or strand any of their stores without an owner.
        const memberships=db.prepare('SELECT m.store,m.role,s.org FROM memberships m JOIN stores s ON s.id=m.store WHERE m.user=?').all(member.id);
        for (const m of memberships) {
          const authority=storeMembership(db,req.account.user.id,m.store);
          if (m.org!==req.account.org || !authority || (target.role==='manager' ? m.store!==req.account.id||m.role!=='staff' : authority.role!=='owner')) throw error('This account also has access outside the stores you can manage.',403);
          if (input.disabled && m.role==='owner' && activeOwners(db,m.store)<=1) throw error('The last active owner cannot be disabled.',409);
        }
        db.prepare('UPDATE users SET disabled=? WHERE id=?').run(Number(input.disabled),member.id);
        if (input.disabled) {
          db.prepare('DELETE FROM sessions WHERE user=?').run(member.id);
          db.prepare(`DELETE FROM sessions WHERE user IS NULL AND account IN (SELECT a.id FROM accounts a WHERE a.email=(SELECT email FROM users WHERE id=?))`).run(member.id);
        }
      }
      if (input.role!==undefined) db.prepare('UPDATE memberships SET role=? WHERE user=? AND store=?').run(input.role,member.id,target.id);
      db.exec('COMMIT');
    } catch(e) {db.exec('ROLLBACK');throw e;}
    res.json({ok:true});
  }));
}
