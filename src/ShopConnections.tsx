import { useEffect, useState } from "react";
import { catalogueApi } from "./catalogue";
type Provider = "shopify" | "woo";
type SyncReport = {
  created: number;
  updated: number;
  unchanged: number;
  markedOut: number;
  needsTypeReview: number;
};
type Connection = {
  provider: Provider;
  connected: boolean;
  baseUrl?: string;
  lastSyncAt?: number;
  lastError?: string;
  report?: SyncReport;
};
type Summary = {
  available: boolean;
  connections: Connection[];
  syncing: boolean;
  chain: boolean;
  master: { store: string; name: string } | null;
  stores: { id: string; name: string }[];
};
const label = (p: Provider) => (p === "shopify" ? "Shopify" : "WooCommerce");
export default function ShopConnections({
  owner,
  onChanged,
  onBusy,
}: {
  owner: boolean;
  onChanged: () => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const [data, setData] = useState<Summary | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [shop, setShop] = useState(""),
    [token, setToken] = useState(""),
    [site, setSite] = useState(""),
    [key, setKey] = useState(""),
    [secret, setSecret] = useState(""),
    [inr, setInr] = useState(false),
    [master, setMaster] = useState("");
  const load = async () => {
    const result = await catalogueApi("/api/integrations");
    setData(result);
    setMaster(result.master?.store || "");
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function action(run: () => Promise<unknown>, success: string) {
    setBusy(true);
    onBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
      setNotice(success);
      await load();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  async function connect(provider: Provider) {
    await action(
      () =>
        catalogueApi(
          "/api/integrations/" + provider,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              provider === "shopify"
                ? { shopDomain: shop, token }
                : { siteUrl: site, key, secret, currency: inr ? "INR" : undefined },
            ),
          },
          40000,
        ),
      `${label(provider)} connected. Use Sync now to import products.`,
    );
    setToken("");
    setKey("");
    setSecret("");
  }
  return (
    <section className="shop-connections">
      <h2>Shop connections</h2>
      <p>
        Sync products, INR prices and stock from Shopify or WooCommerce. Sync uses no AI credits.
        Successful sync replaces upstream product details; saved looks are kept.
      </p>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && (
        <p role="status">
          Updating shop catalogue… Keep this page open. A sync can take several minutes.
        </p>
      )}
      {data && !data.available && (
        <p>
          Ask the server administrator to configure the integration encryption key before connecting
          a shop.
        </p>
      )}
      {data?.syncing && !busy && (
        <p>A catalogue sync is already running. Refresh this page when it finishes.</p>
      )}
      {data?.connections.map((c) => (
        <article className="shop-connection" key={c.provider}>
          <h3>{label(c.provider)}</h3>
          <p>{c.connected ? `Connected: ${c.baseUrl}` : "Not connected"}</p>
          {c.lastSyncAt && (
            <p>
              Last successful sync:{" "}
              {new Date(c.lastSyncAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
            </p>
          )}
          {c.lastError && <p role="alert">{c.lastError}</p>}
          {c.report && (
            <p>
              {c.report.created} created · {c.report.updated} updated · {c.report.unchanged}{" "}
              unchanged · {c.report.markedOut} marked out · {c.report.needsTypeReview} need type
              review
            </p>
          )}
          {c.connected && (
            <>
              <button
                className="button primary"
                disabled={busy || data.syncing}
                onClick={() =>
                  void action(
                    () =>
                      catalogueApi(
                        `/api/integrations/${c.provider}/sync`,
                        { method: "POST" },
                        330000,
                      ),
                    `${label(c.provider)} sync completed.`,
                  )
                }
              >
                Sync {label(c.provider)} now
              </button>
              {owner && (
                <button
                  className="button secondary"
                  disabled={busy || data.syncing}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Disconnect ${label(c.provider)}? Existing products and saved looks will be kept.`,
                      )
                    )
                      void action(
                        () => catalogueApi("/api/integrations/" + c.provider, { method: "DELETE" }),
                        `${label(c.provider)} disconnected.`,
                      );
                  }}
                >
                  Disconnect {label(c.provider)}
                </button>
              )}
            </>
          )}
          {owner && (
            <details>
              <summary>
                {c.connected ? "Update connection" : "Connect " + label(c.provider)}
              </summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void connect(c.provider);
                }}
              >
                {c.provider === "shopify" ? (
                  <>
                    <label>
                      Shopify shop address
                      <input
                        placeholder="your-shop.myshopify.com"
                        value={shop}
                        disabled={busy}
                        required
                        onChange={(e) => setShop(e.target.value)}
                      />
                    </label>
                    <label>
                      Shopify read-only access token
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={token}
                        disabled={busy}
                        required
                        maxLength={1500}
                        onChange={(e) => setToken(e.target.value)}
                      />
                    </label>
                    <p>
                      Use a custom app with read_products and read_inventory access. The shop
                      currency must be INR.
                    </p>
                  </>
                ) : (
                  <>
                    <label>
                      WooCommerce site address
                      <input
                        type="url"
                        placeholder="https://your-shop.com"
                        value={site}
                        disabled={busy}
                        required
                        onChange={(e) => setSite(e.target.value)}
                      />
                    </label>
                    <label>
                      WooCommerce consumer key
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={key}
                        disabled={busy}
                        required
                        maxLength={1500}
                        onChange={(e) => setKey(e.target.value)}
                      />
                    </label>
                    <label>
                      WooCommerce consumer secret
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={secret}
                        disabled={busy}
                        required
                        maxLength={1500}
                        onChange={(e) => setSecret(e.target.value)}
                      />
                    </label>
                    <label className="consent">
                      <input
                        type="checkbox"
                        checked={inr}
                        disabled={busy}
                        required
                        onChange={(e) => setInr(e.target.checked)}
                      />
                      <span>
                        I confirm this WooCommerce shop prices products in INR and this key has Read
                        access only.
                      </span>
                    </label>
                  </>
                )}
                <p>
                  Credentials are encrypted on the server and are not returned to this page. Enter
                  all credentials again when updating.
                </p>
                <button
                  className="button primary"
                  disabled={busy || !data.available || data.syncing}
                >
                  Save {label(c.provider)} connection
                </button>
              </form>
            </details>
          )}
        </article>
      ))}
      {data && (
        <p>
          Connected catalogues sync nightly at 02:00 IST. Failed snapshots publish no changes;
          inspect the last error before trying manually.
        </p>
      )}
      {data?.chain && (
        <article className="shop-connection">
          <h3>Shared master catalogue</h3>
          <p>
            {data.master
              ? `Master store: ${data.master.name}. Other stores see its products read-only alongside their own catalogue.`
              : "No shared master catalogue selected."}
          </p>
          {owner && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(
                  () =>
                    catalogueApi("/api/integrations/master", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ storeId: master || null }),
                    }),
                  "Master catalogue updated.",
                );
              }}
            >
              <label>
                Master catalogue store
                <select value={master} disabled={busy} onChange={(e) => setMaster(e.target.value)}>
                  <option value="">No shared catalogue</option>
                  {data.stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button secondary" disabled={busy}>
                Save master catalogue
              </button>
            </form>
          )}
        </article>
      )}
    </section>
  );
}
