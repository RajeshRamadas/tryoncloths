import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, statfsSync } from "node:fs";
import path from "node:path";

// Capabilities and replay markers never belong in the backed-up account DB.
// Production must mount this directory on tmpfs; tests inject an in-memory DB.
export class ShopperState {
  constructor({ directory, db, now = Date.now } = {}) {
    this.now = now;
    this.owned = !db;
    if (!db) {
      if (typeof directory !== "string" || !path.isAbsolute(directory))
        throw new Error("Configure an absolute TRYON_SHOPPER_STATE_DIR on tmpfs.");
      if (Number(statfsSync(directory).type) !== 0x01021994)
        throw new Error("TRYON_SHOPPER_STATE_DIR must be on tmpfs, outside account backups.");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      db = new DatabaseSync(path.join(directory, "shopper-state.sqlite"));
      chmodSync(path.join(directory, "shopper-state.sqlite"), 0o600);
    }
    this.db = db;
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA temp_store=MEMORY; PRAGMA secure_delete=ON; PRAGMA journal_size_limit=1048576; PRAGMA wal_autocheckpoint=256;
      CREATE TABLE IF NOT EXISTS shopper_state(kind TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,expiresAt INTEGER NOT NULL,PRIMARY KEY(kind,key));
      CREATE INDEX IF NOT EXISTS shopper_state_expiry ON shopper_state(expiresAt);`);
  }
  transaction(fn) {
    if (this.db.isTransaction) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  prune() {
    this.db.prepare("DELETE FROM shopper_state WHERE expiresAt<=?").run(this.now());
  }
  cleanup() {
    this.prune();
    if (!this.db.isTransaction) this.db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  }
  get(kind, key) {
    const row = this.db
      .prepare("SELECT value FROM shopper_state WHERE kind=? AND key=? AND expiresAt>?")
      .get(kind, key, this.now());
    return row ? JSON.parse(row.value) : null;
  }
  put(kind, key, value, expiresAt) {
    this.prune();
    if (this.db.prepare("SELECT count(*) n FROM shopper_state").get().n >= 10000)
      throw Object.assign(new Error("Shopper setup is busy. Try again shortly."), { status: 503 });
    this.db
      .prepare("INSERT INTO shopper_state VALUES(?,?,?,?)")
      .run(kind, key, JSON.stringify(value), expiresAt);
  }
  take(kind, key) {
    return this.transaction(() => {
      const value = this.get(kind, key);
      this.db.prepare("DELETE FROM shopper_state WHERE kind=? AND key=?").run(kind, key);
      return value;
    });
  }
  close() {
    if (this.owned) this.db.close();
  }
}
