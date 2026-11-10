import { useEffect, useState } from "react";
import { catalogueApi } from "./catalogue";

type Usage = {
  monthlyLimit: number;
  held: number;
  committed: number;
  pendingAttempts: number;
  dispatched: number;
  moderation: number;
  moderationLimit: number;
  creditRemaining: number;
  attemptRemaining: number;
  moderationRemaining: number;
};
type Settings = {
  storeName: string;
  canEdit: boolean;
  eligible: boolean;
  plan: string;
  status: string;
  paused: boolean;
  widgetAvailable: false;
  month: string;
  resetsAt: number;
  storeRevision: string;
  organisationRevision: string;
  aiBalance: number;
  store: Usage;
  organisation: Usage;
  ceilings: { store: number; organisation: number };
};
const date = (value: number) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value) + " IST";

export default function ShopperSettings() {
  const [data, setData] = useState<Settings | null>(null),
    [storeLimit, setStoreLimit] = useState("0"),
    [orgLimit, setOrgLimit] = useState("0"),
    [paused, setPaused] = useState(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  function apply(next: Settings) {
    setData(next);
    setStoreLimit(String(next.store.monthlyLimit));
    setOrgLimit(String(next.organisation.monthlyLimit));
    setPaused(next.paused);
  }
  useEffect(() => {
    let live = true;
    void catalogueApi("/api/shopper-settings")
      .then((next) => {
        if (live) apply(next);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function update(pauseOnly = false) {
    if (!data) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = pauseOnly
        ? { action: "pause" }
        : {
            storeLimit: Number(storeLimit),
            organisationLimit: Number(orgLimit),
            paused,
            storeRevision: data.storeRevision,
            organisationRevision: data.organisationRevision,
          };
      apply(
        await catalogueApi("/api/shopper-settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      setNotice(
        pauseOnly
          ? "Shopper spending paused."
          : "Shopper limits saved. The shopper widget is not available yet.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      apply(await catalogueApi("/api/shopper-settings"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="billing-page shopper-settings">
      <nav>
        <a href="/billing">Billing</a>
        <a href="/shopify-shopper">Shopify widget</a>
      </nav>
      <h1>Shopper spending</h1>
      <p>Set monthly allowances for the upcoming “Try it on me” website widget.</p>
      <p className="shopper-stage">
        Widget not available yet. Saving limits prepares your store; it does not start generation or
        publish a website button.
      </p>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {data && (
        <>
          <section>
            <h2>{data.storeName}</h2>
            <p>
              Plan: {data.plan} · {data.status}.{" "}
              {data.eligible
                ? "Eligible for the shopper pilot."
                : "Allowing shopper spending requires an active Growth or Chain subscription."}
            </p>
            <p>
              <strong>
                {data.paused
                  ? "Shopper spending is paused."
                  : "Shopper spending is allowed when the widget is ready."}
              </strong>
            </p>
            <p>
              {data.aiBalance} shared AI credits available. Staff generation uses this same credit
              pool.
            </p>
            <p>
              Allowance month: {data.month} · Asia/Kolkata. Resets {date(data.resetsAt)}.
            </p>
            <div className="shopper-actions">
              <button className="button secondary" disabled={busy} onClick={() => void refresh()}>
                Refresh shopper spending
              </button>
              {data.canEdit && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void update(true)}
                >
                  Pause shopper spending now
                </button>
              )}
            </div>
          </section>
          <section>
            <h2>This month’s shopper usage</h2>
            <div className="billing-cards shopper-usage">
              {(
                [
                  ["Active store", data.store],
                  ["Whole organisation", data.organisation],
                ] as const
              ).map(([label, usage]) => (
                <article key={label}>
                  <h3>{label}</h3>
                  <dl>
                    <dt>Monthly limit</dt>
                    <dd>{usage.monthlyLimit}</dd>
                    <dt>Successful image credits</dt>
                    <dd>{usage.committed}</dd>
                    <dt>Held credits</dt>
                    <dd>{usage.held}</dd>
                    <dt>Provider attempts</dt>
                    <dd>{usage.dispatched}</dd>
                    <dt>Reserved attempts</dt>
                    <dd>{usage.pendingAttempts}</dd>
                    <dt>Credit allowance left</dt>
                    <dd>{usage.creditRemaining}</dd>
                    <dt>Attempt allowance left</dt>
                    <dd>{usage.attemptRemaining}</dd>
                    <dt>Moderation calls</dt>
                    <dd>
                      {usage.moderation} / {usage.moderationLimit}
                    </dd>
                  </dl>
                </article>
              ))}
            </div>
            <p>
              Each successful avatar or try-on uses one AI credit. A new avatar plus its first
              try-on uses two credits. Failed or timed-out provider attempts refund the credit but
              still use the attempt allowance. These are credit and attempt limits, not a guaranteed
              rupee budget.
            </p>
          </section>
          {data.canEdit ? (
            <section>
              <h2>Edit shopper allowances</h2>
              <p>
                The organisation limit is shared by all its stores. Lowering a limit below usage
                blocks new work. Changes never reset the counters.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void update();
                }}
              >
                <div className="billing-details">
                  <label>
                    Store monthly limit
                    <input
                      type="number"
                      min="0"
                      max={data.ceilings.store}
                      step="1"
                      required
                      value={storeLimit}
                      disabled={busy}
                      onChange={(e) => setStoreLimit(e.target.value)}
                    />
                  </label>
                  <label>
                    Organisation monthly limit
                    <input
                      type="number"
                      min="0"
                      max={data.ceilings.organisation}
                      step="1"
                      required
                      value={orgLimit}
                      disabled={busy}
                      onChange={(e) => setOrgLimit(e.target.value)}
                    />
                  </label>
                </div>
                <p>
                  Each limit caps both successful image credits and dispatched provider attempts.
                  Set zero to block new spending. Pilot ceilings: {data.ceilings.store} per store,{" "}
                  {data.ceilings.organisation} per organisation per month.
                </p>
                <label className="consent">
                  <input
                    type="checkbox"
                    checked={!paused}
                    disabled={busy || !data.eligible}
                    onChange={(e) => setPaused(!e.target.checked)}
                  />
                  <span>Allow shopper spending when the widget is ready</span>
                </label>
                <button className="button primary" disabled={busy}>
                  {busy ? "Saving…" : "Save shopper limits"}
                </button>
              </form>
            </section>
          ) : (
            <p>
              Managers can view shopper usage. Only the owner can change limits or pause spending.
            </p>
          )}
        </>
      )}
    </main>
  );
}
