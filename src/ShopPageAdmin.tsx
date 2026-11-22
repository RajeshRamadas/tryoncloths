import { useEffect, useRef, useState } from "react";
import { studioConnection } from "./api";
import { catalogueApi } from "./catalogue";

export type ShopPhoto = { id: string; caption: string; thumbnail: string };
export type ShopPageSettings = {
  slug: string;
  path: string;
  published: boolean;
  tagline: string;
  about: string;
  hours: string;
  whatsapp: string;
  instagramUrl: string;
  facebookUrl: string;
  showCatalogue: boolean;
  showPrices: boolean;
  revision: string;
  updatedAt: number;
  availableItems: number;
  storePhoneAvailable: boolean;
  photoLimit: number;
  photos: ShopPhoto[];
};
type Fields = Pick<
  ShopPageSettings,
  | "slug"
  | "tagline"
  | "about"
  | "hours"
  | "whatsapp"
  | "instagramUrl"
  | "facebookUrl"
  | "showCatalogue"
  | "showPrices"
>;
const fields = (page: ShopPageSettings): Fields => ({
  slug: page.slug,
  tagline: page.tagline,
  about: page.about,
  hours: page.hours,
  whatsapp: page.whatsapp,
  instagramUrl: page.instagramUrl ?? "",
  facebookUrl: page.facebookUrl ?? "",
  showCatalogue: page.showCatalogue,
  showPrices: page.showPrices,
});
type Draft = { revision: string; changes: Partial<Fields> };
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The photo could not be read."));
    reader.readAsDataURL(file);
  });

export function publicShopUrl(path: string) {
  const base = studioConnection().url || window.location.origin;
  return new URL(path, base).href;
}

export default function ShopPageAdmin() {
  const [page, setPage] = useState<ShopPageSettings | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [role, setRole] = useState(""),
    [jewellery, setJewellery] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [caption, setCaption] = useState(""),
    [captions, setCaptions] = useState<Record<string, string>>({});
  const publishing = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    void catalogueApi("/api/health")
      .then((health) => {
        if (live) setJewellery(health.jewelleryCatalogueAvailable === true);
      })
      .catch(() => {});
    void Promise.all([catalogueApi("/api/account"), catalogueApi("/api/shop-page")])
      .then(([account, data]) => {
        if (!live) return;
        setRole(account.account?.user?.role || "");
        setPage(data);
      })
      .catch((e) => {
        if (live) setError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, []);
  const owner = role === "owner",
    editor = owner || role === "manager";
  const values = page ? { ...fields(page), ...draft?.changes } : null;
  async function run(
    action: () => Promise<ShopPageSettings>,
    message: string,
    saved?: (data: ShopPageSettings) => void,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await action();
      setPage(data);
      saved?.(data);
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function save(publish: boolean) {
    if (!page || !values) return;
    const { slug, ...content } = values;
    void run(
      () =>
        catalogueApi(
          "/api/shop-page",
          json("PUT", {
            ...content,
            ...(owner ? { slug } : {}),
            ...(owner && publish ? { published: true } : {}),
            revision: draft?.revision ?? page.revision,
          }),
        ),
      publish
        ? "Shop published. Your link is ready to share."
        : page.published
          ? "Shop changes saved."
          : "Draft saved. You can preview it now.",
      () => {
        setDraft(null);
        if (publish) publishing.current?.scrollIntoView({ block: "start" });
      },
    );
  }
  function unpublish() {
    if (!page || !owner) return;
    const { revision } = page;
    void run(
      () => catalogueApi("/api/shop-page", json("PUT", { published: false, revision })),
      "Shop unpublished. Your team can still preview it.",
      (data) => setDraft((d) => (d?.revision === revision ? { ...d, revision: data.revision } : d)),
    );
  }
  const upload = () =>
    run(async () => {
      if (!file) throw new Error("Choose a shop photo first.");
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 << 20)
        throw new Error("Choose a JPEG, PNG or WebP photo up to 5 MB.");
      const data = await catalogueApi(
        "/api/shop-page/photos",
        json("POST", { image: await readFile(file), caption }),
        60000,
      );
      setFile(null);
      setCaption("");
      return data;
    }, "Photo added to the shop page.");
  const update = <Key extends keyof Fields>(key: Key, value: Fields[Key]) => {
    if (!page) return;
    setDraft((previous) => ({
      revision: previous?.revision ?? page.revision,
      changes: { ...previous?.changes, [key]: value },
    }));
  };
  function clearCaption(id: string) {
    setCaptions((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }
  const link = page ? publicShopUrl(page.path) : "";
  return (
    <main className="billing-page branding-page shop-page-admin">
      <h1>Shop page</h1>
      <p>Set up a shop customers can browse and share from their phones.</p>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!page && !error && <p role="status">Opening shop settings…</p>}
      {page && values && (
        <>
          <section className="shop-publication" ref={publishing} aria-labelledby="shop-status">
            <h2 id="shop-status">
              {page.published ? "Your shop is live" : "Your shop is a draft"}
            </h2>
            <p>
              {page.published
                ? "Share your shop link on Instagram, Facebook, or WhatsApp."
                : owner
                  ? "Preview the page before publishing it to customers."
                  : "Your team can preview the page. The shop owner can publish it."}
            </p>
            {page.published && <p className="shop-public-link">{link}</p>}
            <div className="shop-editor-actions">
              <a className="button secondary" href={link} target="_blank" rel="noreferrer">
                {page.published ? "View live shop" : "Preview saved draft"}
              </a>
              {!page.published && editor && (
                <a className="button secondary" href="#shop-settings">
                  Edit shop details
                </a>
              )}
              {page.published && (
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(link);
                      setNotice("Shop link copied.");
                    } catch {
                      setNotice("Select and copy the shop link above.");
                    }
                  }}
                >
                  Copy shop link
                </button>
              )}
            </div>
            {draft && <p>Save your changes to include them in the preview.</p>}
          </section>
          {editor ? (
            <>
              <section className="shop-setup" aria-labelledby="shop-setup-heading">
                <h2 id="shop-setup-heading">Get your shop ready</h2>
                <ul>
                  <li>
                    <strong>Products</strong>
                    <span>
                      {page.showCatalogue
                        ? page.availableItems
                          ? `${page.availableItems} ${page.availableItems === 1 ? "product" : "products"} ready to show.`
                          : "Add a product so customers have something to browse."
                        : "The catalogue is hidden on your shop page."}
                    </span>
                    <div className="shop-editor-actions">
                      {jewellery && <a href="/jewellery-catalogue">Jewellery catalogue</a>}
                      <a href="/catalogue">Clothing catalogue</a>
                      {!page.showCatalogue && <a href="#shop-catalogue">Show products</a>}
                    </div>
                  </li>
                  <li>
                    <strong>Try-on requests</strong>
                    <span>
                      {page.whatsapp
                        ? "Customers can message you on WhatsApp."
                        : page.storePhoneAvailable
                          ? "Customers can call your store."
                          : "Add a WhatsApp number so customers can request a try-on."}
                    </span>
                    <div className="shop-editor-actions">
                      <a href="#shop-whatsapp">Set WhatsApp number</a>
                      {owner && <a href="/branding">Edit branding</a>}
                    </div>
                  </li>
                </ul>
              </section>
              <section id="shop-settings">
                <h2>Shop settings</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const submitter = (e.nativeEvent as SubmitEvent).submitter;
                    save(submitter instanceof HTMLButtonElement && submitter.value === "publish");
                  }}
                >
                  {owner && (
                    <label>
                      Shop address
                      <input
                        required
                        minLength={3}
                        maxLength={40}
                        pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                        aria-describedby="shop-address-help"
                        value={values.slug}
                        disabled={busy}
                        onChange={(e) => update("slug", e.target.value.toLowerCase())}
                      />
                      <small id="shop-address-help">
                        {page.published
                          ? "Changing this address breaks links you already shared."
                          : "Use lowercase letters, numbers and single hyphens."}
                      </small>
                    </label>
                  )}
                  <label>
                    Tagline
                    <input
                      maxLength={120}
                      placeholder="Bridal and festive wear since 1998"
                      value={values.tagline}
                      disabled={busy}
                      onChange={(e) => update("tagline", e.target.value)}
                    />
                  </label>
                  <label>
                    About the shop
                    <textarea
                      rows={5}
                      maxLength={1200}
                      value={values.about}
                      disabled={busy}
                      onChange={(e) => update("about", e.target.value)}
                    />
                  </label>
                  <label>
                    Opening hours
                    <textarea
                      rows={3}
                      maxLength={300}
                      placeholder={"Mon–Sat 10am–9pm\nSun 11am–7pm"}
                      value={values.hours}
                      disabled={busy}
                      onChange={(e) => update("hours", e.target.value)}
                    />
                  </label>
                  <label>
                    WhatsApp number for try-on requests
                    <input
                      id="shop-whatsapp"
                      type="tel"
                      maxLength={40}
                      placeholder="+91 98765 43210"
                      value={values.whatsapp}
                      disabled={busy}
                      onChange={(e) => update("whatsapp", e.target.value)}
                    />
                  </label>
                  <p>
                    Include the country code. Customers can also call the store phone from your
                    public page if it’s set in Branding.
                  </p>
                  {(
                    [
                      [
                        "instagramUrl",
                        "Instagram profile link",
                        "https://www.instagram.com/yourbrand/",
                      ],
                      ["facebookUrl", "Facebook page link", "https://www.facebook.com/yourbrand"],
                    ] as const
                  ).map(([key, label, placeholder]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="url"
                        maxLength={500}
                        placeholder={placeholder}
                        value={values[key]}
                        disabled={busy}
                        onChange={(e) => update(key, e.target.value)}
                      />
                    </label>
                  ))}
                  <label className="consent" id="shop-catalogue">
                    <input
                      type="checkbox"
                      checked={values.showCatalogue}
                      disabled={busy}
                      onChange={(e) => update("showCatalogue", e.target.checked)}
                    />
                    <span>Show in-stock catalogue items (up to 60, newest first)</span>
                  </label>
                  <label className="consent">
                    <input
                      type="checkbox"
                      checked={values.showPrices}
                      disabled={busy || !values.showCatalogue}
                      onChange={(e) => update("showPrices", e.target.checked)}
                    />
                    <span>Show prices</span>
                  </label>
                  <div className="shop-editor-actions">
                    <button
                      type="submit"
                      value="save"
                      className={owner && !page.published ? "button secondary" : "button primary"}
                      disabled={busy}
                    >
                      {page.published ? "Save changes" : "Save draft"}
                    </button>
                    {owner && !page.published && (
                      <button
                        type="submit"
                        value="publish"
                        className="button primary"
                        disabled={busy}
                      >
                        Publish shop
                      </button>
                    )}
                  </div>
                  {owner && !page.published && (
                    <p>Publishing makes the page available to anyone with the link.</p>
                  )}
                </form>
              </section>
              <section>
                <h2>
                  Shop photos ({page.photos.length}/{page.photoLimit})
                </h2>
                <p>
                  The first photo is featured in your shop gallery. Upload a JPEG, PNG or WebP up to
                  5 MB.
                </p>
                {page.photos.length < page.photoLimit && (
                  <form
                    className="shop-photo-upload"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void upload();
                    }}
                  >
                    <label>
                      Photo
                      <input
                        key={page.photos.length}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busy}
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                      />
                    </label>
                    <label>
                      Caption (optional)
                      <input
                        maxLength={140}
                        value={caption}
                        disabled={busy}
                        onChange={(e) => setCaption(e.target.value)}
                      />
                    </label>
                    <button className="button secondary" disabled={busy || !file}>
                      {busy ? "Uploading…" : "Add photo"}
                    </button>
                  </form>
                )}
                <ol className="shop-photo-list">
                  {page.photos.map((photo, index) => (
                    <li key={photo.id}>
                      <img src={photo.thumbnail} alt={photo.caption || `Shop photo ${index + 1}`} />
                      <div>
                        {index === 0 && <strong>Cover photo</strong>}
                        <label>
                          Caption
                          <input
                            maxLength={140}
                            value={captions[photo.id] ?? photo.caption}
                            disabled={busy}
                            onChange={(e) =>
                              setCaptions((c) => ({ ...c, [photo.id]: e.target.value }))
                            }
                          />
                        </label>
                        <div className="shop-photo-actions">
                          <button
                            className="button secondary"
                            disabled={
                              busy || (captions[photo.id] ?? photo.caption) === photo.caption
                            }
                            onClick={() =>
                              void run(
                                () =>
                                  catalogueApi(
                                    `/api/shop-page/photos/${photo.id}`,
                                    json("PATCH", { caption: captions[photo.id] ?? photo.caption }),
                                  ),
                                "Caption saved.",
                                () => clearCaption(photo.id),
                              )
                            }
                          >
                            Save caption
                          </button>
                          {index > 0 && (
                            <button
                              className="button secondary"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  () =>
                                    catalogueApi(
                                      `/api/shop-page/photos/${photo.id}`,
                                      json("PATCH", { move: "first" }),
                                    ),
                                  "Cover photo changed.",
                                )
                              }
                            >
                              Make cover
                            </button>
                          )}
                          {index > 0 && (
                            <button
                              className="button secondary"
                              aria-label="Move photo earlier"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  () =>
                                    catalogueApi(
                                      `/api/shop-page/photos/${photo.id}`,
                                      json("PATCH", { move: "up" }),
                                    ),
                                  "Photo moved.",
                                )
                              }
                            >
                              Move up
                            </button>
                          )}
                          {index < page.photos.length - 1 && (
                            <button
                              className="button secondary"
                              aria-label="Move photo later"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  () =>
                                    catalogueApi(
                                      `/api/shop-page/photos/${photo.id}`,
                                      json("PATCH", { move: "down" }),
                                    ),
                                  "Photo moved.",
                                )
                              }
                            >
                              Move down
                            </button>
                          )}
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () =>
                                  catalogueApi(`/api/shop-page/photos/${photo.id}`, {
                                    method: "DELETE",
                                  }),
                                "Photo removed.",
                                () => clearCaption(photo.id),
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
              {owner && page.published && (
                <section>
                  <h2>Shop visibility</h2>
                  <p>Unpublish to hide the shop from customers. You can publish it again later.</p>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={unpublish}
                  >
                    Unpublish shop
                  </button>
                </section>
              )}
            </>
          ) : (
            <p>Only the owner or a manager can edit the shop page.</p>
          )}
        </>
      )}
    </main>
  );
}
