import {randomBytes} from 'node:crypto';

// C8 foundation; C14 adds aggregation and the remaining event producers.
export function installEventsSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, org TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    store TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user TEXT REFERENCES users(id) ON DELETE SET NULL, type TEXT NOT NULL,
    refJson TEXT NOT NULL, createdAt INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS events_store_type_date ON events(store,type,createdAt);`);
}
export function recordEvent(db, {org,store,user=null}, type, ref) {
  db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)')
    .run(randomBytes(16).toString('hex'),org,store,user,type,JSON.stringify(ref),Date.now());
}
