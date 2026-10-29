import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,scryptSync} from 'node:crypto';
import {AccountStore} from '../server/accounts.js';
import {GarmentStore} from '../server/garment-store.js';
import {migrateTenancy,storesForUser,storeMembership} from '../server/tenancy.js';

const password='legacy-pilot-password';
const credentials=i=>({email:`store-${i}@example.test`,name:`Store ${i}`,password});
const digest=value=>createHash('sha256').update(value).digest('hex');
const count=(db,table)=>db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
const addAccount=(db,i)=>{
 const c=credentials(i),salt=`test-salt-${i}`;
 db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').run(`account-${i}`,c.email,c.name,salt,scryptSync(password,salt,64));
};

// Construct the pre-C1 schema independently of the new constructor so the
// migration is tested against the actual legacy column layout.
function legacy(filename) {
 const db=new DatabaseSync(filename);
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,salt TEXT NOT NULL,password BLOB NOT NULL);
 CREATE TABLE sessions(token TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
 CREATE TABLE avatars(id TEXT NOT NULL,account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,name TEXT NOT NULL,profileId TEXT NOT NULL,heightCm REAL NOT NULL,weightKg REAL NOT NULL,source TEXT NOT NULL,savedAt INTEGER NOT NULL,image BLOB NOT NULL,thumbnail BLOB NOT NULL,body_type TEXT NOT NULL DEFAULT 'male',template_tone TEXT NOT NULL DEFAULT 'medium',PRIMARY KEY(account,id));
 CREATE TABLE looks(id TEXT NOT NULL,account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,avatarId TEXT NOT NULL,name TEXT NOT NULL,garments TEXT NOT NULL,image BLOB NOT NULL,thumbnail BLOB NOT NULL,savedAt INTEGER NOT NULL,PRIMARY KEY(account,id),FOREIGN KEY(account,avatarId) REFERENCES avatars(account,id) ON DELETE CASCADE);`);
 new GarmentStore({db});
 return db;
}
async function fixture(run) {
 const directory=await mkdtemp(path.join(os.tmpdir(),'forme-tenancy-'));
 try {await run(directory);} finally {await rm(directory,{recursive:true,force:true});}
}

test('three legacy stores migrate once with unchanged credentials, cookies and saved data',async()=>fixture(async directory=>{
 const old=legacy(path.join(directory,'accounts.sqlite'));
 for(let i=1;i<=3;i++){
  addAccount(old,i);const account=`account-${i}`,bytes=Buffer.from(`unchanged-image-${i}`);
  old.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(`cookie-${i}`),account,Date.now()+86400000);
  old.prepare('INSERT INTO avatars VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('avatar',account,'Customer','regular',175,72,'generated',1,bytes,bytes,'male','deep');
  old.prepare('INSERT INTO looks VALUES(?,?,?,?,?,?,?,?)').run('look',account,'avatar','Look','["Shirt"]',bytes,bytes,2);
  old.prepare('INSERT INTO garments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(account,'garment','Shirt','shirt','blue','https://example.test/shirt','hash','00','[0,0,0]',bytes,bytes,3);
  old.prepare('INSERT INTO garment_links VALUES(?,?,?)').run(account,'garment','https://example.test/shirt');
  old.prepare('INSERT INTO garment_results VALUES(?,?,?,?,?,?)').run(account,'result','avatar','garment',bytes,4);
 }
 const tables=['accounts','sessions','avatars','looks','garments','garment_links','garment_results'];
 const snapshots=tables.map(table=>{
  const columns=old.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name).join(',');
  const sql=`SELECT ${columns} FROM ${table} ORDER BY rowid`;
  return {sql,rows:old.prepare(sql).all()};
 });
 old.close();
 let previous;
 for(let startup=0;startup<2;startup++){
  const store=new AccountStore(directory);
  try {
   for(const table of ['orgs','stores','users','memberships'])assert.equal(count(store.db,table),3);
   assert.equal(count(store.db,'invites'),0);
   for(const {sql,rows} of snapshots)assert.deepEqual(store.db.prepare(sql).all(),rows);
   const state=['orgs','stores','users','memberships'].map(t=>store.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
   if(previous)assert.deepEqual(state,previous);previous=state;
   for(let i=1;i<=3;i++){
    const account=await store.login(credentials(i));assert.equal(account.id,`account-${i}`);
    assert.equal(store.user(`cookie-${i}`).id,account.id);
    const owner=store.db.prepare('SELECT u.*,m.role FROM users u JOIN memberships m ON m.user=u.id WHERE m.store=?').get(account.id);
    const original=store.db.prepare('SELECT * FROM accounts WHERE id=?').get(account.id);
    assert.notEqual(owner.id,account.id);assert.equal(owner.role,'owner');assert.equal(owner.disabled,0);
    assert.equal(owner.salt,original.salt);assert.deepEqual(owner.password,original.password);
    assert.equal(store.list(account).length,1);assert.equal(store.listLooks(account).length,1);assert.equal(store.garments.list(account).length,1);
    const org=store.db.prepare('SELECT o.* FROM orgs o JOIN stores s ON s.org=o.id WHERE s.id=?').get(account.id);
    assert.equal(org.plan,'pilot');assert.equal(org.status,'active');assert.equal(org.trialEndsAt,null);
    assert.equal(org.billingEmail,credentials(i).email);
   }
   assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
   assert.ok(store.db.prepare('SELECT customer FROM avatars').all().every(r=>r.customer===null));
   assert.ok(store.db.prepare('SELECT purchasedAt,purchasedSize,staffUser FROM looks').all().every(r=>Object.values(r).every(x=>x===null)));
  }finally{store.close();}
 }
}));

test('fresh database is ready and legacy signups are backfilled on the next startup',async()=>fixture(async directory=>{
 let store=new AccountStore(directory);
 try {
  for(const table of ['orgs','stores','users','memberships','invites'])assert.equal(count(store.db,table),0);
  const account=await store.register(credentials(1));const token=store.session(account);
  assert.equal(store.user(token).id,account.id);
  store.close();store=new AccountStore(directory);
  assert.equal(count(store.db,'stores'),1);assert.equal(store.user(token).id,account.id);
  assert.deepEqual(migrateTenancy(store.db),{migratedAccounts:0});
  await store.resetPassword(account.email,'changed-legacy-password');
  assert.equal(store.user(token),null);
  assert.equal((await store.login({...credentials(1),password:'changed-legacy-password'})).id,account.id);
 }finally{store.close();}
}));

test('a failed backfill rolls back the whole batch and added columns; retry is safe',async()=>fixture(async directory=>{
 const db=legacy(path.join(directory,'accounts.sqlite'));
 try {
  addAccount(db,1);migrateTenancy(db);
  const original=db.prepare('SELECT * FROM orgs').all();
  db.exec('ALTER TABLE avatars DROP COLUMN customer; ALTER TABLE looks DROP COLUMN purchasedAt; ALTER TABLE looks DROP COLUMN purchasedSize; ALTER TABLE looks DROP COLUMN staffUser');
  addAccount(db,2);addAccount(db,3);
  db.exec(`CREATE TRIGGER reject_migration BEFORE INSERT ON users WHEN NEW.email='store-3@example.test' BEGIN SELECT RAISE(ABORT,'test migration failure'); END;`);
  assert.throws(()=>migrateTenancy(db),/test migration failure/);
  for(const table of ['orgs','stores','users','memberships'])assert.equal(count(db,table),1);
  assert.deepEqual(db.prepare('SELECT * FROM orgs').all(),original);
  assert.ok(!db.prepare('PRAGMA table_info(avatars)').all().some(c=>c.name==='customer'));
  assert.ok(!db.prepare('PRAGMA table_info(looks)').all().some(c=>c.name==='staffUser'));
  assert.equal(count(db,'accounts'),3);
  db.exec('DROP TRIGGER reject_migration');
  assert.deepEqual(migrateTenancy(db),{migratedAccounts:2});
  assert.deepEqual(migrateTenancy(db),{migratedAccounts:0});
  assert.equal(count(db,'memberships'),3);
 }finally{db.close();}
}));

test('first-start migration failure leaves no partial tenancy schema or new columns',async()=>fixture(async directory=>{
 const db=legacy(path.join(directory,'accounts.sqlite'));
 try {
  addAccount(db,1);
  // Force a DDL failure after initial CREATE TABLE statements.
  db.exec('CREATE VIEW users AS SELECT id,email FROM accounts');
  assert.throws(()=>migrateTenancy(db));
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='orgs'").get(),undefined);
  assert.ok(!db.prepare('PRAGMA table_info(avatars)').all().some(c=>c.name==='customer'));
  db.exec('DROP VIEW users');assert.deepEqual(migrateTenancy(db),{migratedAccounts:1});
 }finally{db.close();}
}));

test('repository readers isolate memberships and schema rejects invalid roles and cross-org invites',async()=>fixture(async directory=>{
 const db=legacy(path.join(directory,'accounts.sqlite'));
 try {
  addAccount(db,1);addAccount(db,2);migrateTenancy(db);
  const [a,b]=db.prepare('SELECT * FROM memberships ORDER BY store').all();
  const result=storeMembership(db,a.user,a.store);assert.equal(result.role,'owner');
  assert.equal(storeMembership(db,a.user,b.store),null);assert.equal(storeMembership(db,'unknown',a.store),null);
  assert.deepEqual(storesForUser(db,a.user).map(s=>s.id),[a.store]);
  assert.deepEqual(Object.keys(result).sort(),['id','name','org','role']);
  assert.throws(()=>db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(a.user,b.store,'admin'),/CHECK/);
  assert.throws(()=>db.prepare('INSERT INTO memberships VALUES(?,?,?)').run('missing',a.store,'staff'),/FOREIGN KEY/);
  assert.throws(()=>db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(a.user,a.store,'staff'),/UNIQUE/);
  const insert=db.prepare('INSERT INTO invites(tokenHash,org,store,role,email,expiresAt) VALUES(?,?,?,?,?,?)');
  assert.throws(()=>insert.run('hash',result.org,b.store,'staff','staff@example.test',Date.now()+1000),/FOREIGN KEY/);
  insert.run('hash',result.org,a.store,'staff','staff@example.test',Date.now()+1000);
  db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(a.user);
  assert.deepEqual(storesForUser(db,a.user),[]);assert.equal(storeMembership(db,a.user,a.store),null);
  db.prepare('DELETE FROM accounts WHERE id=?').run(a.store);
  assert.equal(count(db,'invites'),0);assert.equal(count(db,'memberships'),1);assert.equal(count(db,'stores'),1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
}));
