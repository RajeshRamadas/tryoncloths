import { randomBytes, createHash } from "node:crypto";
import express from "express";
import { sendMail as defaultSendMail } from "./mailer.js";
import { transaction } from "./catalogue-fields.js";
import { IST, analyticsCsv } from "./analytics.js";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
export function monthlyWindow(now) {
  const local = new Date(now + IST),
    year = local.getUTCFullYear(),
    month = local.getUTCMonth(),
    due = Date.UTC(year, month, 1, 9) - IST;
  if (now < due) return null;
  const from = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10),
    to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { period: from.slice(0, 7), from, to };
}
export class MonthlyAnalytics {
  constructor(
    store,
    { sendMail, publicUrl = process.env.TRYON_PUBLIC_URL, jewelleryEnabled = false } = {},
  ) {
    this.jewelleryEnabled = jewelleryEnabled === true;
    this.store = store;
    this.db = store.db;
    this.sendMail = sendMail || defaultSendMail;
    this.configured = Boolean(
      sendMail || (process.env.SMTP_URL && (process.env.SMTP_FROM || process.env.MAIL_FROM)),
    );
    this.running = false;
    try {
      const url = new URL(publicUrl);
      if (url.protocol === "https:" && !url.username && !url.password) this.base = url.origin;
    } catch {}
  }
  enabled() {
    return Boolean(this.configured && this.base);
  }
  async runDue(now = Date.now()) {
    if (!this.enabled()) return { disabled: true };
    if (this.running) return { busy: true };
    const window = monthlyWindow(now);
    if (!window) return { sent: 0 };
    this.running = true;
    let sent = 0,
      unknown = 0;
    try {
      this.db
        .prepare(
          "UPDATE analytics_monthly SET state='unknown' WHERE state='sending' AND startedAt<?",
        )
        .run(now - 3600000);
      this.db.prepare("DELETE FROM analytics_unsubscribe WHERE expiresAt<=?").run(now);
      const recipients = this.db
        .prepare(
          `SELECT u.id AS user,u.email,m.store,s.org,o.name FROM memberships m JOIN users u ON u.id=m.user JOIN stores s ON s.id=m.store JOIN orgs o ON o.id=s.org
    LEFT JOIN analytics_preferences p ON p.user=u.id
    WHERE m.role='owner' AND u.disabled=0 AND o.status<>'suspended' AND COALESCE(p.monthlyEmail,1)=1 AND NOT EXISTS(SELECT 1 FROM analytics_monthly r WHERE r.user=u.id AND r.org=s.org AND r.period=?)
    GROUP BY u.id,s.org ORDER BY s.org,u.id LIMIT 50`,
        )
        .all(window.period);
      for (const recipient of recipients) {
        const account = this.store.identity(recipient.user, recipient.store);
        if (
          !account ||
          account.user.role !== "owner" ||
          !this.store.analytics.preferences(recipient.user).monthlyEmail
        )
          continue;
        const claimed = this.db
          .prepare(
            "INSERT OR IGNORE INTO analytics_monthly(user,org,period,state,startedAt) VALUES(?,?,?,'sending',?)",
          )
          .run(recipient.user, recipient.org, window.period, now);
        if (!claimed.changes) continue;
        let report, token;
        try {
          report = this.store.analytics.report(
            account,
            { store: "all", from: window.from, to: window.to },
            now,
            { fullProducts: true, jewelleryEnabled: this.jewelleryEnabled },
          );
          token = randomBytes(32).toString("base64url");
          this.db
            .prepare("INSERT INTO analytics_unsubscribe VALUES(?,?,?)")
            .run(digest(token), recipient.user, now + 366 * 86400000);
        } catch {
          this.db
            .prepare(
              "UPDATE analytics_monthly SET state='failed' WHERE user=? AND org=? AND period=?",
            )
            .run(recipient.user, recipient.org, window.period);
          continue;
        }
        const stillOwner = this.store.identity(recipient.user, recipient.store);
        if (
          !stillOwner ||
          stillOwner.user.role !== "owner" ||
          !this.store.analytics.preferences(recipient.user).monthlyEmail
        ) {
          this.db
            .prepare(
              "UPDATE analytics_monthly SET state='skipped' WHERE user=? AND org=? AND period=?",
            )
            .run(recipient.user, recipient.org, window.period);
          continue;
        }
        const unsubscribe = `${this.base}/reports/unsubscribe/${token}`,
          t = report.totals;
        const text = `${recipient.name} — monthly analytics\n${window.from} to ${window.to} (India time)\nTry-ons: ${t.tryons} (${t.tryonsGenerated} generated, ${t.tryonsReused} reused)\nSessions with a try-on: ${t.tryonSessions}\nPurchased looks: ${t.purchases}\nCredits used: ${t.creditsUsed}\nPurchase/session ratio: ${t.conversion == null ? "not available" : t.conversion + "%"}\nThis ratio counts looks, not orders, and can exceed 100%. Historical attribution may be incomplete.\nOpen dashboard: ${this.base}/analytics\nStop monthly analytics emails: ${unsubscribe}`;
        const html = `<h1>${escape(recipient.name)} — monthly analytics</h1><p>${escape(window.from)} to ${escape(window.to)} · India time</p><ul><li>Try-ons: ${t.tryons} (${t.tryonsGenerated} generated, ${t.tryonsReused} reused)</li><li>Sessions with a try-on: ${t.tryonSessions}</li><li>Purchased looks: ${t.purchases}</li><li>Credits used: ${t.creditsUsed}</li></ul><p>Purchase/session ratio: ${t.conversion == null ? "not available" : t.conversion + "%"}. This counts purchased looks, not orders, and can exceed 100%. Historical attribution may be incomplete.</p><p><a href="${this.base}/analytics">Open analytics</a> · <a href="${unsubscribe}">Stop monthly report emails</a></p>`;
        try {
          await this.sendMail({
            to: recipient.email,
            subject: `Forme ${window.period} report — ${recipient.name.replace(/[\r\n]/g, " ").slice(0, 80)}`,
            text,
            html,
            messageId: `<analytics-${digest(recipient.user + recipient.org + window.period)}@${new URL(this.base).hostname}>`,
            headers: {
              "List-Unsubscribe": `<${unsubscribe}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
            attachments: [
              {
                filename: `analytics-${window.period}.csv`,
                content: Buffer.from(analyticsCsv(report)),
                contentType: "text/csv",
              },
            ],
          });
          this.db
            .prepare(
              "UPDATE analytics_monthly SET state='sent',sentAt=? WHERE user=? AND org=? AND period=?",
            )
            .run(now, recipient.user, recipient.org, window.period);
          sent++;
        } catch {
          this.db
            .prepare(
              "UPDATE analytics_monthly SET state='unknown' WHERE user=? AND org=? AND period=?",
            )
            .run(recipient.user, recipient.org, window.period);
          unknown++;
          console.error(JSON.stringify({ event: "analytics_email_unconfirmed" }));
        }
      }
      return { sent, unknown };
    } finally {
      this.running = false;
    }
  }
  token(value, now = Date.now()) {
    return typeof value === "string" && /^[\w-]{43}$/.test(value)
      ? this.db
          .prepare("SELECT user FROM analytics_unsubscribe WHERE hash=? AND expiresAt>?")
          .get(digest(value), now)
      : null;
  }
  unsubscribe(value) {
    const row = this.token(value);
    if (!row) return false;
    transaction(this.db, () =>
      this.db
        .prepare(
          "INSERT INTO analytics_preferences VALUES(?,0) ON CONFLICT(user) DO UPDATE SET monthlyEmail=0",
        )
        .run(row.user),
    );
    return true;
  }
}
export function installAnalyticsUnsubscribe(app, reports) {
  const headers = (res) =>
    res.set({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
  const html = (body) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Monthly report preferences</title><style>body{font:16px/1.6 system-ui;padding:24px;color:#234b3a;background:#f7f8f3}main{max-width:560px;margin:auto}button{padding:12px;font:inherit}</style></head><body><main>${body}</main></body></html>`;
  app.get("/reports/unsubscribe/:token", (req, res) => {
    headers(res);
    if (!reports?.token(req.params.token))
      return res
        .status(410)
        .type("html")
        .send(
          html(
            "<h1>This preference link is unavailable.</h1><p>Change monthly reports in the signed-in analytics dashboard.</p>",
          ),
        );
    res
      .type("html")
      .send(
        html(
          '<h1>Stop monthly analytics reports?</h1><p>This turns off monthly report emails for this owner account. You can turn them on again from Analytics.</p><form method="post"><button>Stop monthly reports</button></form>',
        ),
      );
  });
  app.post(
    "/reports/unsubscribe/:token",
    express.urlencoded({ extended: false, limit: "1kb" }),
    (req, res) => {
      headers(res);
      if (!reports?.unsubscribe(req.params.token))
        return res
          .status(410)
          .type("html")
          .send(html("<h1>This preference link is unavailable.</h1>"));
      res
        .type("html")
        .send(
          html(
            "<h1>Monthly reports stopped.</h1><p>You can enable them again from the signed-in analytics dashboard.</p>",
          ),
        );
    },
  );
}
