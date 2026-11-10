import { requestApi } from "./api";
import { useEffect, useState } from "react";
import { catalogueApi, browseCatalogue } from "./catalogue";
import { billingDownload } from "./billing-api";
import type { StoreGarment } from "./store-garments";
type Config = {
  available: boolean;
  remaining: number;
  role: string;
  profiles: { id: string; name: string; body: string }[];
  tones: { id: string; name: string }[];
  poses: Record<string, string>;
  formats: Record<string, { label: string }>;
};
type Item = {
  id: string;
  name: string;
  sku: string;
  pose: string;
  state: string;
  hasPreview: boolean;
  attempt: string;
  freeUsed: boolean;
  baseCharged: boolean;
  error: string | null;
  reviewUntil: number;
  retry?: { kind: string; total: number; baseReserve: number; extra: number };
};
type Job = {
  id: string;
  createdAt: number;
  profileId: string;
  tone: string;
  formats: string[];
  state: string;
  counts: Record<string, number>;
  items: Item[];
};
function PhotoPreview({ jobId, item }: { jobId: string; item: Item }) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true,
      created = "";
    void requestApi(`/api/photo-jobs/${jobId}/items/${item.id}/preview?attempt=${item.attempt}`)
      .then(async (response) => {
        if (!response.ok)
          throw new Error("The catalogue preview could not be loaded. Refresh this job.");
        const blob = await response.blob();
        if (live) {
          created = URL.createObjectURL(blob);
          setUrl(created);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [jobId, item.id, item.attempt]);
  return (
    <>
      {url && <img src={url} alt={`Catalogue preview of ${item.name}, ${item.pose}`} />}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
export default function CataloguePhotos() {
  const [config, setConfig] = useState<Config | null>(null),
    [products, setProducts] = useState<StoreGarment[]>([]),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Record<string, StoreGarment>>({});
  const [profile, setProfile] = useState("regular"),
    [tone, setTone] = useState("medium"),
    [poses, setPoses] = useState(["front"]),
    [formats, setFormats] = useState(["1:1", "4:5", "3:4"]),
    [consent, setConsent] = useState(false),
    [jobs, setJobs] = useState<Job[]>([]),
    [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [retryConsent, setRetryConsent] = useState<Record<string, boolean>>({});
  const [createId, setCreateId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    setCreateId(crypto.randomUUID());
    setConsent(false);
  }, [selected, profile, tone, poses, formats]);
  const count = Object.keys(selected).length * poses.length;
  async function loadProducts(page = 0) {
    const data = await browseCatalogue({ search, stock: "available", offset: page, limit: 50 });
    setProducts(data.garments);
    setTotal(data.total);
    setOffset(page);
  }
  async function refresh(key?: string) {
    const [settings, list] = await Promise.all([
      catalogueApi("/api/photo-jobs/config"),
      catalogueApi("/api/photo-jobs"),
    ]);
    setConfig(settings);
    setJobs(list.jobs);
    if (key) setJob(await catalogueApi("/api/photo-jobs/" + key));
  }
  useEffect(() => {
    void Promise.all([refresh(), loadProducts()]).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (job?.state !== "processing") return;
    let live = true,
      inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void Promise.all([
        catalogueApi("/api/photo-jobs/" + job.id),
        catalogueApi("/api/photo-jobs/config"),
      ])
        .then(([next, settings]) => {
          if (live) {
            setJob(next);
            setConfig(settings);
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          inFlight = false;
        });
    }, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.state]);
  const toggle = (values: string[], value: string, checked: boolean) =>
    checked ? [...values, value] : values.filter((v) => v !== value);
  async function action(run: () => Promise<Job | void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await run();
      if (result) {
        setJob(result);
        await refresh(result.id);
      } else await refresh(job?.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    await action(async () => {
      const result = await catalogueApi("/api/photo-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: createId,
          garmentIds: Object.keys(selected),
          model: { profileId: profile, tone },
          poses,
          formats,
          generationConsent: consent,
          maxCredits: count,
        }),
      });
      setConsent(false);
      setCreateId(crypto.randomUUID());
      setNotice("Batch queued. You can leave and reopen this job later.");
      return result;
    });
  }
  async function review(item: Item, approved: boolean) {
    if (!job) return;
    await action(() =>
      catalogueApi(`/api/photo-jobs/${job.id}/items/${item.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved }),
      }),
    );
  }
  async function retry(item: Item) {
    if (!job || !item.retry) return;
    await action(async () => {
      const result = await catalogueApi(`/api/photo-jobs/${job.id}/items/${item.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          generationConsent: retryConsent[item.id] === true,
          maxCredits: item.retry!.total,
        }),
      });
      setRetryConsent((previous) => ({ ...previous, [item.id]: false }));
      return result;
    });
  }
  async function download(url: string, name: string) {
    setBusy(true);
    setError("");
    try {
      await billingDownload(url, name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel(remove = false) {
    if (
      !job ||
      !window.confirm(
        remove
          ? "Delete this job and all its images? Download approved images first. Unsettled reservations will be refunded."
          : "Cancel unfinished items? Unapproved base reservations will be refunded. A request already sent to Gemini may still incur a provider charge.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await catalogueApi("/api/photo-jobs/" + job.id + (remove ? "" : "/cancel"), {
        method: remove ? "DELETE" : "POST",
      });
      if (remove) {
        setJob(null);
        await refresh();
      } else await refresh(job.id);
      setNotice(
        remove
          ? "Catalogue job deleted."
          : "Unfinished work cancelled. Approved images remain available.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="billing-page photo-page">
      <nav>
        <a href="/catalogue">Catalogue</a> · <a href="/billing">Billing</a>
      </nav>
      <h1>AI catalogue photos</h1>
      <p>
        Create marketing images from store products and standard adult models. Customer photos and
        saved customer avatars are not used.
      </p>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {config && (
        <>
          <p className="photo-balance">
            <strong>{config.remaining} photo credits available</strong>. Try-on credits are
            separate.
          </p>
          {!config.available && (
            <p role="alert">
              Gemini catalogue generation is unavailable. Ask the studio administrator to check the
              server configuration.
            </p>
          )}
          <section>
            <h2>Create a photo batch</h2>
            <p>
              Choose products and poses, up to 50 combinations. Export formats reuse the same
              generated image.
            </p>
            <form
              className="catalogue-filters"
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                void loadProducts()
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              <label>
                Search photo products
                <input value={search} disabled={busy} onChange={(e) => setSearch(e.target.value)} />
              </label>
              <button className="button secondary" disabled={busy}>
                Search products
              </button>
            </form>
            <div className="photo-products">
              {products.map((p) => (
                <label key={p.id} className="photo-product">
                  <input
                    type="checkbox"
                    aria-label={"Select " + p.name}
                    checked={Boolean(selected[p.id])}
                    disabled={busy || p.needsTypeReview}
                    onChange={(e) => {
                      setSelected((previous) => {
                        const next = { ...previous };
                        if (e.target.checked) next[p.id] = p;
                        else delete next[p.id];
                        return next;
                      });
                      setConsent(false);
                    }}
                  />
                  <img src={p.thumbnail} alt="" />
                  <span>
                    {p.name}
                    {p.needsTypeReview && <small>Confirm clothing type in Catalogue first.</small>}
                  </span>
                </label>
              ))}
            </div>
            {!products.length && <p>No matching products. Add products in Catalogue first.</p>}
            <div>
              <button
                className="button secondary"
                disabled={busy || offset === 0}
                onClick={() =>
                  void loadProducts(Math.max(0, offset - 50)).catch((e) => setError(e.message))
                }
              >
                Previous photo products
              </button>
              <button
                className="button secondary"
                disabled={busy || offset + 50 >= total}
                onClick={() => void loadProducts(offset + 50).catch((e) => setError(e.message))}
              >
                Next photo products
              </button>
            </div>
            <p>{Object.keys(selected).length} products selected across pages.</p>
            {Object.keys(selected).length > 0 && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setSelected({});
                  setConsent(false);
                }}
              >
                Clear photo selection
              </button>
            )}
            <div className="measurement-grid">
              <label>
                Standard photo model
                <select
                  value={profile}
                  disabled={busy}
                  onChange={(e) => {
                    setProfile(e.target.value);
                    setConsent(false);
                  }}
                >
                  {config.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.body === "female" ? "Female" : "Male"} · {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Model complexion
                <select
                  value={tone}
                  disabled={busy}
                  onChange={(e) => {
                    setTone(e.target.value);
                    setConsent(false);
                  }}
                >
                  {config.tones.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset>
              <legend>Model poses</legend>
              {Object.entries(config.poses).map(([id, description]) => (
                <label className="consent" key={id}>
                  <input
                    type="checkbox"
                    checked={poses.includes(id)}
                    disabled={busy}
                    onChange={(e) => {
                      setPoses(toggle(poses, id, e.target.checked));
                      setConsent(false);
                    }}
                  />
                  <span>
                    {id === "front" ? "Front" : "Three-quarter"}
                    <small>{description}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Export formats</legend>
              {Object.entries(config.formats).map(([id, value]) => (
                <label className="consent" key={id}>
                  <input
                    type="checkbox"
                    checked={formats.includes(id)}
                    disabled={busy}
                    onChange={(e) => {
                      setFormats(toggle(formats, id, e.target.checked));
                      setConsent(false);
                    }}
                  />
                  <span>{value.label}</span>
                </label>
              ))}
            </fieldset>
            <p>
              {count} images · reserve {count} photo credits. The base credit is charged on
              approval. One regeneration per image is included; later successful regenerations cost
              one extra credit, including previews you reject. Failed attempts refund unsettled
              credits.
            </p>
            <p>
              Review within 7 days. Unapproved base reservations are then refunded. Review garment
              details, anatomy and the model before downloading.
            </p>
            <label className="consent">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                I agree to send these product photos and standard models to Gemini and reserve{" "}
                {count} photo credits.
              </span>
            </label>
            <button
              className="button primary"
              disabled={
                busy ||
                !config.available ||
                !consent ||
                count < 1 ||
                count > 50 ||
                !formats.length ||
                config.remaining < count
              }
              onClick={() => void create()}
            >
              Generate catalogue batch
            </button>
            {count > 50 && <p role="alert">Choose at most 50 product/pose combinations.</p>}
            {config.remaining < count && <p>Ask the owner to buy photo credits in Billing.</p>}
          </section>
          <section>
            <h2>Saved photo jobs</h2>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await refresh(job?.id);
                })
              }
            >
              Refresh photo jobs
            </button>
            {jobs.length === 0 ? (
              <p>No catalogue photo jobs yet.</p>
            ) : (
              <ul className="photo-job-list">
                {jobs.map((j) => (
                  <li key={j.id}>
                    <span>
                      {new Date(j.createdAt).toLocaleString()} · {j.state} ·{" "}
                      {Object.entries(j.counts)
                        .map(([state, n]) => `${n} ${state}`)
                        .join(", ")}
                    </span>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void action(() => catalogueApi("/api/photo-jobs/" + j.id))}
                    >
                      Open photo job
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {job && (
            <section aria-label="Catalogue photo review">
              <h2>Review catalogue images</h2>
              <p>
                {job.state} ·{" "}
                {config.profiles.find((p) => p.id === job.profileId)?.name || "Standard model"} ·{" "}
                {config.tones.find((t) => t.id === job.tone)?.name || "Template complexion"}
              </p>
              <button
                className="button primary"
                disabled={busy || !job.counts.approved}
                onClick={() =>
                  void download(`/api/photo-jobs/${job.id}/download.zip`, "catalogue-photos.zip")
                }
              >
                Download approved photos ZIP
              </button>
              {job.state !== "cancelled" && job.state !== "completed" && (
                <button className="button secondary" disabled={busy} onClick={() => void cancel()}>
                  Cancel unfinished photo work
                </button>
              )}
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void cancel(true)}
              >
                Delete photo job
              </button>
              <div className="photo-review-grid">
                {job.items.map((item) => (
                  <article className="photo-review-item" key={item.id}>
                    <h3>
                      {item.name} · {item.pose === "front" ? "Front" : "Three-quarter"}
                    </h3>
                    <p>
                      State: {item.state}
                      {item.baseCharged ? " · Base credit charged." : ""}
                    </p>
                    {item.hasPreview && <PhotoPreview jobId={job.id} item={item} />}
                    <p>{item.error}</p>
                    {job.state !== "cancelled" && ["ready", "rejected"].includes(item.state) && (
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() => void review(item, true)}
                      >
                        Approve {item.name} · {item.pose}
                      </button>
                    )}
                    {job.state !== "cancelled" &&
                      ["ready", "approved"].includes(item.state) &&
                      item.reviewUntil > Date.now() && (
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => void review(item, false)}
                        >
                          Reject {item.name} · {item.pose}
                        </button>
                      )}
                    {job.state !== "cancelled" && item.retry && (
                      <>
                        <p>
                          {item.retry.kind === "reprocess"
                            ? "Reprocess the saved image without another AI call."
                            : item.retry.kind === "free"
                              ? "The included regeneration is available."
                              : item.retry.kind === "paid"
                                ? "A successful regeneration costs one extra photo credit."
                                : "Retry generation manually."}{" "}
                          Reserve {item.retry.baseReserve} base + {item.retry.extra} extra credits.
                        </p>
                        <label className="consent">
                          <input
                            type="checkbox"
                            aria-label={"Confirm retry " + item.name + " · " + item.pose}
                            checked={Boolean(retryConsent[item.id])}
                            disabled={busy}
                            onChange={(e) =>
                              setRetryConsent((previous) => ({
                                ...previous,
                                [item.id]: e.target.checked,
                              }))
                            }
                          />
                          <span>
                            I confirm this manual request and its {item.retry.total}-credit
                            reservation.
                          </span>
                        </label>
                        <button
                          className="button secondary"
                          disabled={
                            busy ||
                            !retryConsent[item.id] ||
                            config.remaining < item.retry.total ||
                            !config.available
                          }
                          onClick={() => void retry(item)}
                        >
                          {item.retry.kind === "reprocess" ? "Reprocess" : "Regenerate"} {item.name}{" "}
                          · {item.pose}
                        </button>
                      </>
                    )}
                    {item.state === "approved" &&
                      job.formats.map((format) => (
                        <button
                          className="button secondary"
                          key={format}
                          disabled={busy}
                          onClick={() =>
                            void download(
                              `/api/photo-jobs/${job.id}/items/${item.id}/files/${encodeURIComponent(format)}`,
                              `${item.sku.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64) || "product"}-ai-model-${format.replace(":", "x")}.jpg`,
                            )
                          }
                        >
                          Download {config.formats[format].label} · {item.name} · {item.pose}
                        </button>
                      ))}
                  </article>
                ))}
              </div>
              <p>
                These are AI-generated marketing illustrations, not fit guarantees. Exports include
                AI provenance metadata; review before publishing. White padding preserves the
                complete model and garment.
              </p>
            </section>
          )}
        </>
      )}
    </main>
  );
}
