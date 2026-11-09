import { randomUUID } from "node:crypto";
import { BillingError } from "./billing.js";

export async function abortable(work, signal) {
  signal.throwIfAborted();
  let cancel;
  const stopped = new Promise((_, reject) => {
    cancel = () => reject(signal.reason || new DOMException("Request stopped.", "AbortError"));
    signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return work();
      }),
      stopped,
    ]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

// Non-personal durable leases coordinate staff, catalogue and shopper work across
// workers. The remote provider may still bill after our HTTP request is aborted.
export class ImageSlots {
  constructor(billing, { now = Date.now } = {}) {
    this.billing = billing;
    this.db = billing.db;
    this.now = now;
    billing.transaction(() =>
      this.db.exec(`CREATE TABLE IF NOT EXISTS image_call_leases(
      slot INTEGER PRIMARY KEY CHECK(slot IN (0,1)),token TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('staff','catalogue','shopper')),expiresAt INTEGER NOT NULL);`),
    );
  }
  acquire({ token = randomUUID(), kind = "staff", leaseMs = 195000 } = {}) {
    if (
      !["staff", "catalogue", "shopper"].includes(kind) ||
      !Number.isInteger(leaseMs) ||
      leaseMs < 1 ||
      leaseMs > 360000
    )
      throw new Error("Invalid image lease.");
    return this.billing.transaction(() => {
      this.db.prepare("DELETE FROM image_call_leases WHERE expiresAt<=?").run(this.now());
      const occupied = this.db.prepare("SELECT slot,kind FROM image_call_leases").all();
      if (kind === "shopper" && occupied.some((row) => row.kind === "shopper")) return null;
      // A deployment may inherit unexpired catalogue leases created before the
      // shared limiter existed. Count those until recovery/expiry releases them.
      const hasPhotos = this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='photo_worker_leases'")
        .get();
      const legacy = hasPhotos
        ? this.db
            .prepare(
              "SELECT count(*) n FROM photo_worker_leases p WHERE p.expiresAt>? AND NOT EXISTS(SELECT 1 FROM image_call_leases l WHERE l.token=p.token)",
            )
            .get(this.now()).n
        : 0;
      if (occupied.length + legacy >= 2) return null;
      const slot = [0, 1].find((n) => !occupied.some((row) => row.slot === n));
      if (slot === undefined) return null;
      this.db
        .prepare("INSERT INTO image_call_leases VALUES(?,?,?,?)")
        .run(slot, token, kind, this.now() + leaseMs);
      return token;
    });
  }
  release(token) {
    this.db.prepare("DELETE FROM image_call_leases WHERE token=?").run(token);
  }
  assert(token) {
    if (
      !this.db
        .prepare("SELECT 1 FROM image_call_leases WHERE token=? AND expiresAt>?")
        .get(token, this.now())
    )
      throw new BillingError(
        "image_lease_expired",
        "This image request expired. No automatic retry was sent.",
      );
  }
  async run({ signal, kind = "staff", timeoutMs = 180000 } = {}, work) {
    signal?.throwIfAborted();
    const lease = this.acquire({ kind, leaseMs: timeoutMs + 15000 });
    if (!lease)
      throw new BillingError(
        "image_busy",
        "The studio is processing other images. Try again shortly.",
        429,
      );
    const combined = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    try {
      return await abortable(() => work(combined), combined);
    } finally {
      this.release(lease);
    }
  }
}
