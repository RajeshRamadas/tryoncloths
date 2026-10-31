import {createHash,randomUUID} from 'node:crypto';
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const digest=value=>createHash('sha256').update(value).digest('hex');
export function trialKeys(input){
 const entries=[['email',input.email.trim().toLowerCase()]];
 if(input.phone){let p=String(input.phone).replace(/[\s()-]/g,'');if(/^\d{10}$/.test(p))p='+91'+p;if(!/^\+[1-9]\d{7,14}$/.test(p))throw error('Enter a mobile number with country code.');entries.push(['phone',p]);}
 if(input.gstin){const g=String(input.gstin).trim().toUpperCase();if(!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g))throw error('Enter a valid GSTIN.');entries.push(['gstin',g]);}
 return entries.map(([kind,value])=>({kind,value:digest(value)}));
}
export function claimTrial(db,org,input){
 for(const {kind,value} of trialKeys(input)){
  const row=db.prepare('SELECT org FROM trial_identities WHERE kind=? AND value=?').get(kind,value);
  if(row&&row.org!==org)throw error('A trial has already been used with these details. Sign in to your existing store or contact support.',409);
  db.prepare('INSERT OR IGNORE INTO trial_identities VALUES(?,?,?)').run(kind,value,org);
 }
}
export function installAdminSchema(db){
 db.exec('BEGIN IMMEDIATE');try{db.exec(`CREATE TABLE IF NOT EXISTS trial_identities(kind TEXT NOT NULL,value TEXT NOT NULL,org TEXT NOT NULL,PRIMARY KEY(kind,value));
 CREATE TABLE IF NOT EXISTS billing_admin_audit(id TEXT PRIMARY KEY,org TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL,createdAt INTEGER NOT NULL);`);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
}
export function adminCommand(store,args){
 const [command,org,...values]=args,db=store.db;
 if(command==='list-orgs')return db.prepare('SELECT id,name,plan,status,trialEndsAt FROM orgs ORDER BY name,id').all().map(o=>({...o,aiCredits:store.billing.balance(o.id)}));
 if(!db.prepare('SELECT id FROM orgs WHERE id=?').get(org||''))throw error('Organisation not found.',404);
 if(command==='grant-credits'){
  const [pool,amount,ref]=values;
  if(!/^\d+$/.test(amount||''))throw error('Use a nonnegative integer credit amount.');
  return {id:store.billing.grant(org,pool,Number(amount),'grant_admin',ref),balance:store.billing.balance(org,pool)};
 }
 return store.billing.transaction(()=>{
  if(command==='set-plan'){
   const [plan]=values;if(!['pilot','starter','growth','chain'].includes(plan))throw error('Choose pilot, starter, growth or chain.');
   // Administrative override is explicit and does not fabricate a payment or grant.
   db.prepare("UPDATE orgs SET plan=?,status='active',pastDueSince=NULL WHERE id=?").run(plan,org);
  }else if(command==='extend-trial'){
   const days=Number(values[0]),row=db.prepare('SELECT status,trialEndsAt FROM orgs WHERE id=?').get(org);
   if(row.status!=='trial'||!Number.isInteger(days)||days<1||days>365)throw error('Extend an existing trial by 1–365 days.');
   db.prepare('UPDATE orgs SET trialEndsAt=? WHERE id=?').run(Math.max(Date.now(),row.trialEndsAt||0)+days*86400000,org);
  }else if(command==='suspend')db.prepare("UPDATE orgs SET status='suspended' WHERE id=?").run(org);
  else throw error('Unknown admin command.');
  db.prepare('INSERT INTO billing_admin_audit VALUES(?,?,?,?,?)').run(randomUUID(),org,command,JSON.stringify(values),Date.now());
  return db.prepare('SELECT id,plan,status,trialEndsAt FROM orgs WHERE id=?').get(org);
 });
}
export function usage(store,account,now=Date.now()){
 const end=new Date(now+330*60000).toISOString().slice(0,10),start=new Date(Date.parse(end+'T00:00:00Z')-29*86400000).toISOString().slice(0,10);
 const from=Date.parse(start+'T00:00:00Z')-330*60000,to=Date.parse(end+'T00:00:00Z')+86400000-330*60000;
 const rows=store.db.prepare(`SELECT h.user,u.name,h.action,t.createdAt FROM ledger t JOIN ledger h ON h.id=t.ref LEFT JOIN users u ON u.id=h.user
 WHERE t.kind='commit' AND h.org=? AND h.store=? AND t.createdAt>=? AND t.createdAt<? ORDER BY t.createdAt`).all(account.org,account.id,from,to);
 const days=Array.from({length:30},(_,i)=>({date:new Date(Date.parse(start+'T00:00:00Z')+i*86400000).toISOString().slice(0,10),credits:0}));
 const staff=new Map(),actions=new Map();
 for(const row of rows){const day=new Date(row.createdAt+330*60000).toISOString().slice(0,10);days.find(d=>d.date===day).credits++;
  const u=staff.get(row.user)||{id:row.user,name:row.name||'Former staff',credits:0};u.credits++;staff.set(row.user,u);actions.set(row.action,(actions.get(row.action)||0)+1);}
 return {storeId:account.id,storeName:account.name,timezone:'Asia/Kolkata',from:start,to:end,total:rows.length,days,staff:[...staff.values()],actions:[...actions].map(([action,credits])=>({action,credits}))};
}
export function usageCsv(report){
 const cell=v=>'"'+String(/^\s*[=+@\-\t\r]/.test(String(v))?"'"+v:v).replaceAll('"','""')+'"';
 return [['Group','Label','Credits'],...report.days.map(d=>['Day',d.date,d.credits]),...report.staff.map(s=>['Staff',s.name,s.credits]),...report.actions.map(a=>['Action',a.action,a.credits])].map(r=>r.map(cell).join(',')).join('\r\n');
}
