import { randomUUID } from "node:crypto";
import { BillingError, billingFailure, validRequestId } from "./billing.js";
import { requireRole, storeMembership } from "./tenancy.js";

export const SHOPPER_LIMITS = Object.freeze({
  store: 50,
  organisation: 200,
  storeModeration: 100,
  organisationModeration: 400,
  deadlineMs: 120000,
});
const bindingLifetime = 30 * 60000;
const fail = (code, message, status = 409) => new BillingError(code, message, status);
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const live = "('reserved','dispatching')";

export function shopperMonth(now = Date.now()) {
  const month = new Date(now + 330 * 60000).toISOString().slice(0, 7);
  const [year, m] = month.split("-").map(Number);
  return { month, timezone: "Asia/Kolkata", resetsAt: Date.UTC(year, m, 1) - 330 * 60000 };
}

// Internal accounting only. There is deliberately no public generation route or
// HTTP endpoint which accepts store ids, creates operations, or dispatches work.
export class ShopperBudgets {
  constructor(store, { now = Date.now } = {}) {
    this.db = store.db;
    this.billing = store.billing;
    this.now = now;
    // Request/session fingerprints are transient, never written into backed-up
    // accounting records. A different worker or restart fails closed on replay;
    // C16.3 will supply the shared transient session store, separate from SQLite.
    this.bindings = new Map();
    this.billing.transaction(() =>
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS shopper_org_settings(
        org TEXT PRIMARY KEY REFERENCES orgs(id),monthlyLimit INTEGER NOT NULL CHECK(monthlyLimit BETWEEN 0 AND 200),revision TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS shopper_store_settings(
        store TEXT PRIMARY KEY REFERENCES stores(id),monthlyLimit INTEGER NOT NULL CHECK(monthlyLimit BETWEEN 0 AND 50),
        paused INTEGER NOT NULL DEFAULT 1 CHECK(paused IN (0,1)),revision TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS shopper_budgets(
        org TEXT NOT NULL REFERENCES orgs(id),store TEXT NOT NULL,month TEXT NOT NULL,
        held INTEGER NOT NULL DEFAULT 0 CHECK(held>=0),committed INTEGER NOT NULL DEFAULT 0 CHECK(committed>=0),
        pendingAttempts INTEGER NOT NULL DEFAULT 0 CHECK(pendingAttempts>=0),dispatched INTEGER NOT NULL DEFAULT 0 CHECK(dispatched>=0),
        moderation INTEGER NOT NULL DEFAULT 0 CHECK(moderation>=0),PRIMARY KEY(org,store,month));
      CREATE TABLE IF NOT EXISTS shopper_operations(
        id TEXT PRIMARY KEY,org TEXT NOT NULL,store TEXT NOT NULL,month TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('avatar','tryon')),
        hold TEXT UNIQUE REFERENCES ledger(id),state TEXT NOT NULL CHECK(state IN ('reserved','dispatching','committed','refunded')),
        storeRevision TEXT NOT NULL,orgRevision TEXT NOT NULL,createdAt INTEGER NOT NULL,deadline INTEGER NOT NULL,
        dispatchedAt INTEGER,settledAt INTEGER,reason TEXT,
        FOREIGN KEY(store,org) REFERENCES stores(id,org));
      CREATE INDEX IF NOT EXISTS shopper_operations_lease ON shopper_operations(state,deadline);
      CREATE TABLE IF NOT EXISTS shopper_moderation_operations(
        id TEXT PRIMARY KEY,org TEXT NOT NULL,store TEXT NOT NULL,month TEXT NOT NULL,operation TEXT,
        createdAt INTEGER NOT NULL,FOREIGN KEY(store,org) REFERENCES stores(id,org));
    `),
    );
  }
  actor(account, write = false) {
    const actor = storeMembership(this.db, account?.user?.id ?? "", account?.id ?? "");
    if (
      !actor ||
      actor.org !== account.org ||
      !(write ? ["owner"] : ["owner", "manager"]).includes(actor.role)
    )
      throw fail(
        "shopper_role_required",
        write
          ? "Only the owner can change shopper spending."
          : "Only owners and managers can view shopper spending.",
        403,
      );
    return actor;
  }
  policy(storeId) {
    const store = this.db
      .prepare(
        "SELECT s.id,s.org,s.name,o.plan,o.status FROM stores s JOIN orgs o ON o.id=s.org WHERE s.id=?",
      )
      .get(storeId);
    if (!store) throw fail("shopper_store_unavailable", "This shopper store is unavailable.", 403);
    const org = this.db.prepare("SELECT * FROM shopper_org_settings WHERE org=?").get(store.org);
    const local = this.db
      .prepare("SELECT * FROM shopper_store_settings WHERE store=?")
      .get(storeId);
    return {
      ...store,
      storeLimit: local?.monthlyLimit ?? 0,
      organisationLimit: org?.monthlyLimit ?? 0,
      paused: local ? Boolean(local.paused) : true,
      storeRevision: local?.revision ?? "0",
      organisationRevision: org?.revision ?? "0",
      eligible: ["growth", "chain"].includes(store.plan) && store.status === "active",
    };
  }
  ensurePolicy(policy) {
    if (!policy.eligible)
      throw fail(
        "shopper_plan_required",
        "Shopper spending needs an active Growth or Chain subscription.",
        403,
      );
    if (policy.paused || !policy.storeLimit || !policy.organisationLimit)
      throw fail("shopper_paused", "Shopper spending is paused or has no monthly allowance.");
  }
  counts(org, store, month) {
    return (
      this.db
        .prepare(
          "SELECT held,committed,pendingAttempts,dispatched,moderation FROM shopper_budgets WHERE org=? AND store=? AND month=?",
        )
        .get(org, store, month) ?? {
        held: 0,
        committed: 0,
        pendingAttempts: 0,
        dispatched: 0,
        moderation: 0,
      }
    );
  }
  scopes(policy) {
    return [
      [policy.id, policy.storeLimit, SHOPPER_LIMITS.storeModeration],
      ["", policy.organisationLimit, SHOPPER_LIMITS.organisationModeration],
    ];
  }
  change(operation, changes) {
    for (const store of [operation.store, ""]) {
      this.db
        .prepare("INSERT OR IGNORE INTO shopper_budgets(org,store,month) VALUES(?,?,?)")
        .run(operation.org, store, operation.month);
      const entries = Object.entries(changes);
      this.db
        .prepare(
          `UPDATE shopper_budgets SET ${entries.map(([k]) => `${k}=${k}+?`).join(",")} WHERE org=? AND store=? AND month=?`,
        )
        .run(...entries.map(([, v]) => v), operation.org, store, operation.month);
    }
  }
  available(policy, month, { held = false } = {}) {
    for (const [store, limit] of this.scopes(policy)) {
      const c = this.counts(policy.org, store, month);
      if (
        c.committed + c.held + (held ? 0 : 1) > limit ||
        c.dispatched + c.pendingAttempts + (held ? 0 : 1) > limit
      )
        throw fail(
          "shopper_cap_reached",
          `${store ? "Store" : "Organisation"} shopper monthly allowance reached. No new image request was sent.`,
          429,
        );
    }
  }
  view(account) {
    this.actor(account);
    const policy = this.policy(account.id),
      period = shopperMonth(this.now());
    const summary = (store, limit, moderationLimit) => {
      const c = this.counts(policy.org, store, period.month);
      return {
        ...c,
        monthlyLimit: limit,
        moderationLimit,
        creditRemaining: Math.max(0, limit - c.held - c.committed),
        attemptRemaining: Math.max(0, limit - c.dispatched - c.pendingAttempts),
        moderationRemaining: Math.max(0, moderationLimit - c.moderation),
      };
    };
    return {
      ...period,
      storeName: policy.name,
      canEdit: this.actor(account).role === "owner",
      eligible: policy.eligible,
      plan: policy.plan,
      status: policy.status,
      paused: policy.paused,
      widgetAvailable: false,
      stage: "budgets-only",
      storeRevision: policy.storeRevision,
      organisationRevision: policy.organisationRevision,
      store: summary(policy.id, policy.storeLimit, SHOPPER_LIMITS.storeModeration),
      organisation: summary("", policy.organisationLimit, SHOPPER_LIMITS.organisationModeration),
      aiBalance: this.billing.balance(policy.org),
      ceilings: { store: SHOPPER_LIMITS.store, organisation: SHOPPER_LIMITS.organisation },
    };
  }
  update(account, input = {}) {
    return this.billing.transaction(() => {
      this.actor(account, true);
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw fail("invalid_shopper_settings", "Use valid shopper settings.", 400);
      const policy = this.policy(account.id);
      // Pausing cannot enable spending: make the emergency action independent of
      // stale form revisions, unsaved fields, plan eligibility or available funds.
      if (input.action === "pause" && Object.keys(input).length === 1) {
        this.db
          .prepare(
            "INSERT INTO shopper_store_settings VALUES(?,?,1,?) ON CONFLICT(store) DO UPDATE SET paused=1,revision=excluded.revision",
          )
          .run(account.id, policy.storeLimit, randomUUID());
        return this.view(account);
      }
      const keys = [
        "storeLimit",
        "organisationLimit",
        "paused",
        "storeRevision",
        "organisationRevision",
      ];
      if (
        Object.keys(input).some((k) => !keys.includes(k)) ||
        !Number.isInteger(input.storeLimit) ||
        input.storeLimit < 0 ||
        input.storeLimit > 50 ||
        !Number.isInteger(input.organisationLimit) ||
        input.organisationLimit < 0 ||
        input.organisationLimit > 200 ||
        typeof input.paused !== "boolean"
      )
        throw fail(
          "invalid_shopper_settings",
          "Use whole-number monthly limits: store 0–50, organisation 0–200, and a pause choice.",
          400,
        );
      if (
        input.storeRevision !== policy.storeRevision ||
        input.organisationRevision !== policy.organisationRevision
      )
        throw fail(
          "shopper_settings_changed",
          "Shopper settings changed in another tab or store. Refresh before saving.",
        );
      if (!input.paused && !policy.eligible)
        throw fail(
          "shopper_plan_required",
          "Only active Growth or Chain subscriptions can allow shopper spending.",
          403,
        );
      if (!input.paused && (!input.storeLimit || !input.organisationLimit))
        throw fail(
          "invalid_shopper_settings",
          "Set both monthly limits above zero before allowing shopper spending.",
          400,
        );
      this.db
        .prepare(
          "INSERT INTO shopper_store_settings VALUES(?,?,?,?) ON CONFLICT(store) DO UPDATE SET monthlyLimit=excluded.monthlyLimit,paused=excluded.paused,revision=excluded.revision",
        )
        .run(account.id, input.storeLimit, Number(input.paused), randomUUID());
      this.db
        .prepare(
          "INSERT INTO shopper_org_settings VALUES(?,?,?) ON CONFLICT(org) DO UPDATE SET monthlyLimit=excluded.monthlyLimit,revision=excluded.revision",
        )
        .run(account.org, input.organisationLimit, randomUUID());
      return this.view(account);
    });
  }
  operation(id) {
    if (!validRequestId(id))
      throw fail("invalid_request_id", "Use a UUID v4 shopper request id.", 400);
    const op = this.db.prepare("SELECT * FROM shopper_operations WHERE id=?").get(id.toLowerCase());
    if (!op) throw fail("shopper_operation_missing", "Shopper operation not found.", 404);
    return op;
  }
  // store is an INTERNAL verified-session store id, not an HTTP argument. Future
  // shopper routes must validate installation/session/consent/abuse guards first.
  reserve({ store, requestId, action, bodyHash, sessionHash }) {
    if (
      !validRequestId(requestId) ||
      !["avatar", "tryon"].includes(action) ||
      !hash(bodyHash) ||
      !hash(sessionHash)
    )
      throw fail(
        "invalid_shopper_operation",
        "Use a valid shopper operation and request fingerprint.",
        400,
      );
    return this.billing.transaction(() => {
      this.sweep();
      const key = requestId.toLowerCase(),
        prior = this.db.prepare("SELECT * FROM shopper_operations WHERE id=?").get(key);
      if (prior) {
        const binding = this.bindings.get(key);
        if (
          prior.store !== store ||
          prior.action !== action ||
          !binding ||
          binding.bodyHash !== bodyHash ||
          binding.sessionHash !== sessionHash
        )
          throw fail(
            "duplicate_request",
            "This request id belongs to a different or expired shopper operation.",
          );
        return { fresh: false, operation: prior };
      }
      const policy = this.policy(store),
        now = this.now(),
        { month } = shopperMonth(now);
      this.ensurePolicy(policy);
      this.available(policy, month);
      if (this.db.prepare(`SELECT 1 FROM shopper_operations WHERE state IN ${live}`).get())
        throw fail(
          "shopper_busy",
          "Another shopper generation is in progress. Try again shortly.",
          429,
        );
      this.db
        .prepare(
          `INSERT INTO shopper_operations(id,org,store,month,action,state,storeRevision,orgRevision,createdAt,deadline)
        VALUES(?,?,?,?,?,'reserved',?,?,?,?)`,
        )
        .run(
          key,
          policy.org,
          store,
          month,
          action,
          policy.storeRevision,
          policy.organisationRevision,
          now,
          now + SHOPPER_LIMITS.deadlineMs,
        );
      const hold = this.billing.reserveShopper(key);
      this.db.prepare("UPDATE shopper_operations SET hold=? WHERE id=?").run(hold, key);
      const operation = this.operation(key);
      this.change(operation, { held: 1, pendingAttempts: 1 });
      if (this.bindings.size >= 10000) this.bindings.delete(this.bindings.keys().next().value);
      this.bindings.set(key, { bodyHash, sessionHash, expiresAt: now + bindingLifetime });
      return { fresh: true, operation };
    });
  }
  checkActive(op) {
    if (op.deadline <= this.now())
      throw fail(
        "shopper_request_expired",
        "This shopper attempt expired. It will not be retried.",
      );
    const policy = this.policy(op.store);
    this.ensurePolicy(policy);
    if (policy.storeRevision !== op.storeRevision || policy.organisationRevision !== op.orgRevision)
      throw fail(
        "shopper_settings_changed",
        "Shopper settings changed. This attempt cannot continue.",
      );
    this.available(policy, op.month, { held: true });
  }
  dispatch(id) {
    const result = this.billing.transaction(() => {
      const op = this.operation(id);
      if (op.state !== "reserved")
        throw fail("duplicate_request", "This shopper attempt was already dispatched or settled.");
      try {
        this.checkActive(op);
      } catch (error) {
        this.refundOperation(op, "blocked");
        return { error };
      }
      this.change(op, { pendingAttempts: -1, dispatched: 1 });
      this.db
        .prepare("UPDATE shopper_operations SET state='dispatching',dispatchedAt=? WHERE id=?")
        .run(this.now(), op.id);
      return { operation: this.operation(op.id) };
    });
    if (result.error) throw result.error;
    return result.operation;
  }
  refundOperation(op, reason) {
    if (["committed", "refunded"].includes(op.state)) return false;
    this.billing.refund(op.hold, reason);
    this.change(op, { held: -1, ...(op.state === "reserved" ? { pendingAttempts: -1 } : {}) });
    this.db
      .prepare("UPDATE shopper_operations SET state='refunded',settledAt=?,reason=? WHERE id=?")
      .run(this.now(), reason, op.id);
    return true;
  }
  refund(id) {
    return this.billing.transaction(() => this.refundOperation(this.operation(id), "failed"));
  }
  commit(id) {
    const result = this.billing.transaction(() => {
      const op = this.operation(id);
      if (op.state === "committed") return { changed: false };
      if (op.state !== "dispatching")
        throw fail(
          "shopper_operation_settled",
          "Only an active dispatched shopper attempt can complete.",
        );
      try {
        this.checkActive(op);
      } catch (error) {
        this.refundOperation(op, "blocked");
        return { error };
      }
      this.billing.commit(op.hold);
      this.change(op, { held: -1, committed: 1 });
      this.db
        .prepare("UPDATE shopper_operations SET state='committed',settledAt=? WHERE id=?")
        .run(this.now(), op.id);
      return { changed: true };
    });
    if (result.error) throw result.error;
    return result.changed;
  }
  reserveModeration({ store, requestId, operationId = null }) {
    if (!validRequestId(requestId))
      throw fail("invalid_request_id", "Use a UUID v4 moderation request id.", 400);
    return this.billing.transaction(() => {
      const prior = this.db
        .prepare("SELECT * FROM shopper_moderation_operations WHERE id=?")
        .get(requestId.toLowerCase());
      if (prior) {
        if (prior.store !== store || prior.operation !== operationId)
          throw fail("duplicate_request", "This moderation request id was already used.");
        return { fresh: false };
      }
      const policy = this.policy(store);
      this.ensurePolicy(policy);
      let month = shopperMonth(this.now()).month;
      if (operationId) {
        const op = this.operation(operationId);
        if (op.store !== store || op.state !== "dispatching")
          throw fail("shopper_operation_missing", "No active shopper output to moderate.", 403);
        this.checkActive(op);
        month = op.month;
      } else {
        this.available(policy, month);
        if (this.billing.balance(policy.org) < 1)
          throw fail(
            "credits_required",
            "No AI credits are available for shopper generation.",
            402,
          );
      }
      for (const [scope, , limit] of this.scopes(policy))
        if (this.counts(policy.org, scope, month).moderation >= limit)
          throw fail(
            "shopper_moderation_cap",
            "The shopper moderation allowance is exhausted.",
            429,
          );
      this.db
        .prepare("INSERT INTO shopper_moderation_operations VALUES(?,?,?,?,?,?)")
        .run(requestId.toLowerCase(), policy.org, store, month, operationId, this.now());
      this.change({ org: policy.org, store, month }, { moderation: 1 });
      return { fresh: true };
    });
  }
  sweep(now = this.now()) {
    return this.billing.transaction(() => {
      const expired = this.db
        .prepare(`SELECT * FROM shopper_operations WHERE state IN ${live} AND deadline<=?`)
        .all(now);
      for (const op of expired)
        this.refundOperation(op, op.state === "dispatching" ? "unknown" : "expired");
      for (const [key, binding] of this.bindings)
        if (binding.expiresAt <= now) this.bindings.delete(key);
      return expired.length;
    });
  }
}

export function installShopperBudgetRoutes(app, store, { requireUser, sameOrigin, wrap }) {
  const route = (fn) =>
    wrap((req, res) => {
      try {
        res.set("Cache-Control", "no-store").json(fn(req));
      } catch (e) {
        if (!billingFailure(res, e)) throw e;
      }
    });
  app.get(
    "/api/shopper-settings",
    requireUser,
    requireRole("owner", "manager"),
    route((req) => store.shoppers.view(req.account)),
  );
  app.put(
    "/api/shopper-settings",
    sameOrigin,
    requireUser,
    requireRole("owner"),
    route((req) => store.shoppers.update(req.account, req.body)),
  );
}
