import { jewelleryAnalytics } from "./jewellery-analytics.js";
import { transaction } from "./catalogue-fields.js";
import { requireRole } from "./tenancy.js";
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const IST = 330 * 60000;
export function dateRange(query = {}, now = Date.now()) {
  const date = (value) => {
    if (
      typeof value !== "string" ||
      !/^20\d{2}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + "T00:00:00Z")) ||
      new Date(Date.parse(value + "T00:00:00Z")).toISOString().slice(0, 10) !== value
    )
      throw fail("Use valid dates in YYYY-MM-DD format.");
    return value;
  };
  const to = date(query.to ?? new Date(now + IST).toISOString().slice(0, 10));
  const from = date(
    query.from ??
      new Date(Date.parse(to + "T00:00:00Z") - 29 * 86400000).toISOString().slice(0, 10),
  );
  const start = Date.parse(from + "T00:00:00Z") - IST,
    end = Date.parse(to + "T00:00:00Z") + 86400000 - IST;
  if (end <= start || end - start > 366 * 86400000)
    throw fail("Choose a date range of 1–366 days.");
  return { from, to, start, end };
}
export function installAnalyticsSchema(db) {
  transaction(db, () =>
    db.exec(`
 CREATE TABLE IF NOT EXISTS analytics_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
 INSERT OR IGNORE INTO analytics_meta VALUES('tracking_started',strftime('%s','now')*1000);
 INSERT OR IGNORE INTO analytics_meta VALUES('jewellery_tracking_started',strftime('%s','now')*1000);
 CREATE TABLE IF NOT EXISTS analytics_preferences(user TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,monthlyEmail INTEGER NOT NULL CHECK(monthlyEmail IN (0,1)));
 CREATE TABLE IF NOT EXISTS analytics_unsubscribe(hash TEXT PRIMARY KEY,user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expiresAt INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS analytics_unsubscribe_user ON analytics_unsubscribe(user);
 CREATE TABLE IF NOT EXISTS analytics_monthly(user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,org TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,period TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('sending','sent','unknown','failed','skipped')),startedAt INTEGER NOT NULL,sentAt INTEGER,PRIMARY KEY(user,org,period));
 CREATE INDEX IF NOT EXISTS ledger_reporting ON ledger(org,store,createdAt);
 `),
  );
}
const countTypes = {
  avatar_generated: "avatarsGenerated",
  tryon_generated: "tryonsGenerated",
  tryon_reused: "tryonsReused",
  look_saved: "looksSaved",
  look_shared: "looksShared",
  share_viewed: "shareViews",
  whatsapp_sent: "whatsappSent",
  catalogue_photo: "cataloguePhotos",
};
const metric = () => ({
  avatarsGenerated: 0,
  tryonsGenerated: 0,
  tryonsReused: 0,
  tryons: 0,
  tryonSessions: 0,
  looksSaved: 0,
  looksShared: 0,
  shareViews: 0,
  whatsappSent: 0,
  cataloguePhotos: 0,
  purchases: 0,
  creditsUsed: 0,
  aiCredits: 0,
  photoCredits: 0,
  conversion: null,
  _sessions: new Set(),
});
const finished = (row) => {
  const { _sessions, ...values } = row;
  return {
    ...values,
    tryonSessions: _sessions.size,
    conversion: _sessions.size ? Math.round((values.purchases / _sessions.size) * 1000) / 10 : null,
  };
};
const day = (timestamp) => new Date(timestamp + IST).toISOString().slice(0, 10);
export class Analytics {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    installAnalyticsSchema(this.db);
  }
  scope(account, requested) {
    if (!["owner", "manager"].includes(account.user?.role))
      throw fail("Analytics is available to store owners and managers.", 403);
    if (requested !== undefined && typeof requested !== "string")
      throw fail("Choose a valid store.");
    const target = requested || account.id;
    if (account.user.role !== "owner" && target !== account.id)
      throw fail("Managers can view only their active store.", 403);
    const stores =
      account.user.role === "owner"
        ? this.db
            .prepare("SELECT id,name FROM stores WHERE org=? ORDER BY name,id")
            .all(account.org)
        : this.db
            .prepare("SELECT id,name FROM stores WHERE id=? AND org=?")
            .all(account.id, account.org);
    if (target === "all") return { selected: stores, available: stores, selection: "all" };
    const selected = stores.filter((s) => s.id === target);
    if (!selected.length) throw fail("You cannot view analytics for this store.", 403);
    return { selected, available: stores, selection: target };
  }
  report(account, query = {}, now = Date.now(), options = {}) {
    if (this.db.isTransaction) return this.buildReport(account, query, now, options);
    this.db.exec("BEGIN");
    try {
      const report = this.buildReport(account, query, now, options);
      this.db.exec("COMMIT");
      return report;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  buildReport(
    account,
    query = {},
    now = Date.now(),
    { fullProducts = false, jewelleryEnabled = false } = {},
  ) {
    const scope = this.scope(account, query.store),
      range = dateRange(query, now),
      ids = scope.selected.map((s) => s.id);
    if (!ids.length) throw fail("No stores are available.", 403);
    const marks = ids.map(() => "?").join(","),
      params = [account.org, ...ids, range.start, range.end];
    const n = this.db
      .prepare(
        `SELECT count(*) AS n FROM events WHERE org=? AND store IN (${marks}) AND createdAt>=? AND createdAt<?`,
      )
      .get(...params).n;
    if (n > 1000000)
      throw fail(
        "This range exceeds one million events. Select fewer stores or a shorter period.",
        413,
      );
    const totals = metric(),
      stores = new Map(scope.selected.map((s) => [s.id, { id: s.id, name: s.name, ...metric() }])),
      staff = new Map(),
      products = new Map(),
      days = new Map();
    for (let time = range.start; time < range.end; time += 86400000)
      days.set(day(time), { date: day(time), ...metric() });
    const staffRow = (storeId, user) => {
      const key = storeId + ":" + (user || "unknown");
      if (!staff.has(key)) staff.set(key, { id: user || null, storeId, ...metric() });
      return staff.get(key);
    };
    const product = (storeId, id) => {
      const key = storeId + ":" + id;
      if (!products.has(key))
        products.set(key, {
          id,
          storeId,
          tries: 0,
          generated: 0,
          reused: 0,
          purchases: 0,
          _sessions: new Set(),
        });
      return products.get(key);
    };
    const jewellery =
      jewelleryEnabled === true
        ? jewelleryAnalytics({ stores: scope.selected, dates: [...days.keys()], day })
        : null;
    let untrackedProducts = 0,
      unattributedPurchases = 0,
      ignoredEvents = 0;
    const eventCounts = {};
    for (const event of this.db
      .prepare(
        `SELECT store,user,type,refJson,createdAt FROM events WHERE org=? AND store IN (${marks}) AND createdAt>=? AND createdAt<? ORDER BY createdAt,rowid`,
      )
      .iterate(...params)) {
      let ref;
      try {
        ref = JSON.parse(event.refJson) || {};
      } catch {
        ignoredEvents++;
        continue;
      }
      jewellery?.event(event, ref);
      eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
      const targets = [
          totals,
          stores.get(event.store),
          days.get(day(event.createdAt)),
          staffRow(event.store, event.user),
        ],
        key = countTypes[event.type];
      if (key) for (const row of targets) row[key]++;
      if (["tryon_generated", "tryon_reused"].includes(event.type)) {
        const session =
          event.store +
          ":" +
          (ref.sessionId ||
            "legacy-event-" + event.createdAt + "-" + event.user + "-" + (ref.requestId || ""));
        for (const row of targets) {
          row.tryons++;
          row._sessions.add(session);
        }
        if (ref.garmentId) {
          const p = product(event.store, ref.garmentId);
          p.tries++;
          p[event.type === "tryon_generated" ? "generated" : "reused"]++;
          p._sessions.add(session);
        } else untrackedProducts++;
      }
    }
    // Reconstruct active marks as of the selected end date. Undo and re-mark do
    // not inflate purchases; ties use append order, not random event IDs.
    const purchases = this.db
      .prepare(
        `WITH ranked AS (
    SELECT store,user,type,refJson,createdAt,row_number() OVER (PARTITION BY store,json_extract(refJson,'$.lookId') ORDER BY createdAt DESC,rowid DESC) AS position
    FROM events WHERE org=? AND store IN (${marks}) AND type IN ('purchase_marked','purchase_unmarked') AND createdAt<? AND json_valid(refJson) AND json_type(refJson,'$.lookId')='text')
    SELECT * FROM ranked WHERE position=1 AND type='purchase_marked' AND createdAt>=?`,
      )
      .all(account.org, ...ids, range.end, range.start);
    for (const event of purchases) {
      const ref = JSON.parse(event.refJson);
      jewellery?.purchase(event, ref);
      const targets = [
        totals,
        stores.get(event.store),
        days.get(day(event.createdAt)),
        staffRow(event.store, event.user),
      ];
      for (const row of targets) row.purchases++;
      if (!ref.sessionId || !totals._sessions.has(event.store + ":" + ref.sessionId))
        unattributedPurchases++;
      for (const id of new Set(Array.isArray(ref.garmentIds) ? ref.garmentIds : []))
        product(event.store, id).purchases++;
    }
    const commits = this.db
      .prepare(
        `SELECT h.store,h.user,h.action,h.pool,t.createdAt FROM ledger t JOIN ledger h ON h.id=t.ref WHERE t.kind='commit' AND h.org=? AND h.store IN (${marks}) AND t.createdAt>=? AND t.createdAt<?`,
      )
      .iterate(...params);
    for (const row of commits)
      for (const target of [
        totals,
        stores.get(row.store),
        days.get(day(row.createdAt)),
        staffRow(
          row.store,
          row.user || (row.action?.startsWith("shopper_") ? "shopper-self-service" : null),
        ),
      ]) {
        target.creditsUsed++;
        target[row.pool === "photo" ? "photoCredits" : "aiCredits"]++;
      }
    const productRows = [...products.values()]
      .map((p) => {
        const saved = this.db
          .prepare("SELECT name,sku,brand FROM garments WHERE account=? AND id=?")
          .get(p.storeId, p.id);
        return {
          id: p.id,
          storeId: p.storeId,
          name: saved?.name || "Deleted product",
          sku: saved?.sku || null,
          brand: saved?.brand || "",
          tries: p.tries,
          generated: p.generated,
          reused: p.reused,
          purchases: p.purchases,
          sessions: p._sessions.size,
          conversion: p._sessions.size
            ? Math.round((p.purchases / p._sessions.size) * 1000) / 10
            : null,
        };
      })
      .sort(
        (a, b) =>
          b.tries - a.tries || a.storeId.localeCompare(b.storeId) || a.id.localeCompare(b.id),
      );
    const staffRows = [...staff.values()]
      .map((row) => ({
        ...finished(row),
        name:
          row.id === "shopper-self-service"
            ? "Shopper self-service"
            : row.id
              ? this.db.prepare("SELECT name FROM users WHERE id=?").get(row.id)?.name ||
                "Former staff"
              : "Unattributed staff",
      }))
      .sort((a, b) => b.tryons - a.tryons || a.name.localeCompare(b.name));
    return {
      from: range.from,
      to: range.to,
      timezone: "Asia/Kolkata",
      selection: scope.selection,
      availableStores: scope.available,
      trackingSince: this.db
        .prepare("SELECT value FROM analytics_meta WHERE key='tracking_started'")
        .get().value,
      ...(jewellery
        ? {
            jewellery: jewellery.result(this.db, {
              fullProducts,
              trackingSince: this.db
                .prepare("SELECT value FROM analytics_meta WHERE key='jewellery_tracking_started'")
                .get().value,
            }),
          }
        : {}),
      totals: {
        ...finished(totals),
        untrackedProductTryons: untrackedProducts,
        unattributedPurchases,
        ignoredEvents,
      },
      eventCounts,
      days: [...days.values()].map(finished),
      stores: [...stores.values()].map(finished),
      staff: staffRows,
      products: fullProducts ? productRows : productRows.slice(0, 50),
      triedNotBought: productRows.filter((p) => p.tries > 0 && p.purchases === 0).slice(0, 50),
      productsTracked: productRows.length,
    };
  }
  preferences(user) {
    return {
      monthlyEmail:
        this.db.prepare("SELECT monthlyEmail FROM analytics_preferences WHERE user=?").get(user)
          ?.monthlyEmail !== 0,
    };
  }
  setPreferences(user, monthlyEmail) {
    if (typeof monthlyEmail !== "boolean")
      throw fail("Choose whether monthly report emails are enabled.");
    transaction(this.db, () => {
      this.db
        .prepare(
          "INSERT INTO analytics_preferences VALUES(?,?) ON CONFLICT(user) DO UPDATE SET monthlyEmail=excluded.monthlyEmail",
        )
        .run(user, Number(monthlyEmail));
      if (monthlyEmail) this.db.prepare("DELETE FROM analytics_unsubscribe WHERE user=?").run(user);
    });
    return this.preferences(user);
  }
}
export function analyticsCsv(report) {
  const rows = [
    [
      "Group",
      "Store",
      "Label",
      "Generated try-ons",
      "Reused try-ons",
      "Sessions with try-on",
      "Purchased looks",
      "Credits used",
      "Purchase/session %",
      ...(report.jewellery
        ? [
            "Free overlays",
            "Completed comparisons",
            "Partial comparisons",
            "Looks saved",
            "Sets saved",
            "Complete looks saved",
            "Share links created",
            "Share page views",
          ]
        : []),
    ],
  ];
  const add = (group, store, label, row) =>
    rows.push([
      group,
      store,
      label,
      row.tryonsGenerated ?? row.generated ?? 0,
      row.tryonsReused ?? row.reused ?? 0,
      row.tryonSessions ?? row.sessions ?? 0,
      row.purchases || 0,
      group.startsWith("Jewellery ") ? "" : row.creditsUsed || 0,
      row.conversion ?? "",
      ...(report.jewellery
        ? [
            row.overlays ?? "",
            row.comparisonsCompleted ?? "",
            row.comparisonsPartial ?? "",
            row.looksSaved ?? "",
            row.setsSaved ?? "",
            row.completeLooksSaved ?? "",
            row.looksShared ?? "",
            row.shareViews ?? "",
          ]
        : []),
    ]);
  add("Total", "All selected stores", `${report.from} to ${report.to} IST`, report.totals);
  for (const row of report.days) add("Day", "All selected stores", row.date, row);
  for (const row of report.stores) add("Store", row.name, row.name, row);
  for (const row of report.staff)
    add(
      "Staff",
      report.availableStores.find((s) => s.id === row.storeId)?.name || "",
      row.name,
      row,
    );
  for (const row of report.products)
    add(
      "Product",
      report.availableStores.find((s) => s.id === row.storeId)?.name || "",
      row.name + (row.sku ? " · " + row.sku : ""),
      row,
    );
  const j = report.jewellery;
  if (j) {
    add("Jewellery total", "All selected stores", `${report.from} to ${report.to} IST`, j.totals);
    for (const r of j.days) add("Jewellery day", "All selected stores", r.date, r);
    for (const r of j.stores) add("Jewellery store", r.name, r.name, r);
    for (const r of j.staff)
      add(
        "Jewellery staff",
        report.availableStores.find((s) => s.id === r.storeId)?.name || "",
        r.name,
        r,
      );
    for (const r of j.products)
      add(
        "Jewellery product",
        report.availableStores.find((s) => s.id === r.storeId)?.name || "",
        r.name + (r.sku ? " · " + r.sku : ""),
        r,
      );
  }
  return rows
    .map((row) =>
      row
        .map((value) => {
          let text = String(value);
          if (/^\s*[=+@\-\t\r]/.test(text)) text = "'" + text;
          return '"' + text.replaceAll('"', '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
}
export function installAnalyticsRoutes(
  app,
  store,
  { requireUser, sameOrigin, wrap, reports, jewelleryEnabled = false },
) {
  const analytics = store.analytics,
    manager = requireRole("owner", "manager"),
    owner = requireRole("owner");
  app.get(
    "/api/analytics",
    requireUser,
    manager,
    wrap((req, res) =>
      res.json(analytics.report(req.account, req.query, Date.now(), { jewelleryEnabled })),
    ),
  );
  app.get(
    "/api/analytics.csv",
    requireUser,
    manager,
    wrap((req, res) =>
      res
        .type("text/csv")
        .set("Content-Disposition", 'attachment; filename="analytics.csv"')
        .send(
          analyticsCsv(
            analytics.report(req.account, req.query, Date.now(), {
              fullProducts: true,
              jewelleryEnabled,
            }),
          ),
        ),
    ),
  );
  app.get(
    "/api/analytics/preferences",
    requireUser,
    owner,
    wrap((req, res) =>
      res.json({
        ...analytics.preferences(req.account.user.id),
        emailConfigured: reports?.enabled() || false,
        reports: store.db
          .prepare(
            "SELECT period,state,startedAt,sentAt FROM analytics_monthly WHERE user=? AND org=? ORDER BY period DESC LIMIT 12",
          )
          .all(req.account.user.id, req.account.org),
      }),
    ),
  );
  app.put(
    "/api/analytics/preferences",
    sameOrigin,
    requireUser,
    owner,
    wrap((req, res) =>
      res.json(analytics.setPreferences(req.account.user.id, req.body?.monthlyEmail)),
    ),
  );
}
