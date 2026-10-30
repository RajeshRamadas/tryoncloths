import { randomBytes } from 'node:crypto';

const id = () => randomBytes(16).toString('hex');

// C1 is additive: legacy accounts and sessions remain authoritative until C2.
// Keep all new schema and backfill writes in one transaction so startup can
// safely retry after an interrupted or failed migration.
export function migrateTenancy(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS orgs (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, gstin TEXT, billingEmail TEXT NOT NULL,
        plan TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('trial','active','past_due','suspended')),
        trialEndsAt INTEGER, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS stores (
        id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        org TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
        name TEXT NOT NULL, city TEXT, phone TEXT, brandingJson TEXT NOT NULL DEFAULT '{}',
        UNIQUE(id,org));
      CREATE INDEX IF NOT EXISTS stores_org ON stores(org);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, phone TEXT, name TEXT NOT NULL,
        salt TEXT NOT NULL, password BLOB NOT NULL,
        disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)), createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships (
        user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        store TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('owner','manager','staff')), PRIMARY KEY(user,store));
      CREATE INDEX IF NOT EXISTS memberships_store ON memberships(store);
      CREATE TABLE IF NOT EXISTS invites (
        tokenHash TEXT PRIMARY KEY, org TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
        store TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','manager','staff')),
        email TEXT NOT NULL, expiresAt INTEGER NOT NULL, acceptedAt INTEGER,
        FOREIGN KEY(store,org) REFERENCES stores(id,org) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS invites_store ON invites(store);
    `);
    const avatarColumns = new Set(db.prepare('PRAGMA table_info(avatars)').all().map(c => c.name));
    if (!avatarColumns.has('customer')) db.exec('ALTER TABLE avatars ADD COLUMN customer TEXT');
    const lookColumns = new Set(db.prepare('PRAGMA table_info(looks)').all().map(c => c.name));
    if (!lookColumns.has('purchasedAt')) db.exec('ALTER TABLE looks ADD COLUMN purchasedAt INTEGER');
    if (!lookColumns.has('purchasedSize')) db.exec('ALTER TABLE looks ADD COLUMN purchasedSize TEXT');
    if (!lookColumns.has('staffUser')) db.exec('ALTER TABLE looks ADD COLUMN staffUser TEXT REFERENCES users(id) ON DELETE SET NULL');

    const pending = db.prepare('SELECT a.* FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM stores s WHERE s.id=a.id)').all();
    const orgInsert = db.prepare('INSERT INTO orgs(id,name,billingEmail,plan,status,createdAt) VALUES(?,?,?,?,?,?)');
    const storeInsert = db.prepare('INSERT INTO stores(id,org,name) VALUES(?,?,?)');
    const userInsert = db.prepare('INSERT INTO users(id,email,name,salt,password,createdAt) VALUES(?,?,?,?,?,?)');
    const membershipInsert = db.prepare('INSERT INTO memberships(user,store,role) VALUES(?,?,?)');
    const now = Date.now();
    for (const account of pending) {
      const orgId = id(), userId = id();
      // Preserve the existing scrypt salt/hash byte-for-byte, never plaintext.
      orgInsert.run(orgId, account.name, account.email, 'pilot', 'active', now);
      storeInsert.run(account.id, orgId, account.name);
      userInsert.run(userId, account.email, account.name, account.salt, account.password, now);
      membershipInsert.run(userId, account.id, 'owner');
    }
    db.exec('COMMIT');
    return { migratedAccounts: pending.length };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Repository readers expose only membership-scoped metadata, never credentials.
// The calling authentication layer must supply the authenticated user id.
export function storesForUser(db, userId) {
  return db.prepare(`SELECT s.id,s.org,s.name,m.role
    FROM memberships m JOIN stores s ON s.id=m.store JOIN users u ON u.id=m.user
    WHERE m.user=? AND u.disabled=0 ORDER BY s.name,s.id`).all(userId);
}

export function storeMembership(db, userId, storeId) {
  return db.prepare(`SELECT s.id,s.org,s.name,m.role
    FROM memberships m JOIN stores s ON s.id=m.store JOIN users u ON u.id=m.user
    WHERE m.user=? AND m.store=? AND u.disabled=0`).get(userId, storeId) || null;
}

// Reconcile passwords changed while C1 still used accounts, exactly once.
// Subsequent starts must never overwrite user credentials from legacy rows.
export function migrateUserSessions(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS auth_migrations (version TEXT PRIMARY KEY)');
    const columns = new Set(db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name));
    if (!columns.has('user')) db.exec('ALTER TABLE sessions ADD COLUMN user TEXT REFERENCES users(id) ON DELETE CASCADE');
    if (!columns.has('store')) db.exec('ALTER TABLE sessions ADD COLUMN store TEXT REFERENCES stores(id) ON DELETE CASCADE');
    if (!db.prepare("SELECT 1 FROM auth_migrations WHERE version='c2'").get()) {
      db.exec(`UPDATE users SET
        salt=(SELECT a.salt FROM accounts a WHERE a.email=users.email),
        password=(SELECT a.password FROM accounts a WHERE a.email=users.email)
        WHERE EXISTS (SELECT 1 FROM accounts a JOIN memberships m ON m.store=a.id
          WHERE a.email=users.email AND m.user=users.id AND m.role='owner');
        INSERT INTO auth_migrations VALUES('c2');`);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

// Apply after authentication has set req.account. Recheck auth on each request.
export function requireRole(...roles) {
  return (req,res,next) => {
    if (!req.account) return res.status(401).json({error:'Sign in to your store account.'});
    if (!roles.includes(req.account.user?.role)) return res.status(403).json({error:'Your store role cannot perform this action.'});
    next();
  };
}
