import { useEffect, useState } from "react";
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
  showCatalogue: boolean;
  showPrices: boolean;
  revision: string;
  updatedAt: number;
  photoLimit: number;
  photos: ShopPhoto[];
};
type Fields = Pick<
  ShopPageSettings,
  "slug" | "published" | "tagline" | "about" | "hours" | "whatsapp" | "showCatalogue" | "showPrices"
>;
const fields = (page: ShopPageSettings): Fields => ({
  slug: page.slug,
  published: page.published,
  tagline: page.tagline,
  about: page.about,
  hours: page.hours,
  whatsapp: page.whatsapp,
  showCatalogue: page.showCatalogue,
  showPrices: page.showPrices,
});
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
    [values, setValues] = useState<Fields | null>(null),
    [role, setRole] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [caption, setCaption] = useState(""),
    [captions, setCaptions] = useState<Record<string, string>>({});
  const loaded = (data: ShopPageSettings) => {
    setPage(data);
    setValues(fields(data));
    setCaptions(Object.fromEntries(data.photos.map((p) => [p.id, p.caption])));
  };
  useEffect(() => {
    let live = true;
    void Promise.all([catalogueApi("/api/account"), catalogueApi("/api/shop-page")])
      .then(([account, data]) => {
        if (!live) return;
        setRole(account.account?.user?.role || "");
        loaded(data);
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
  async function run(action: () => Promise<ShopPageSettings>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      loaded(await action());
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const save = () =>
    run(() => {
      const { slug, published, ...content } = values!;
      return catalogueApi(
        "/api/shop-page",
        json("PUT", {
          ...content,
          ...(owner ? { slug, published } : {}),
          revision: page!.revision,
        }),
      );
    }, "Shop page saved. Customers see the changes on their next visit.");
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
  const update = (key: keyof Fields, value: string | boolean) =>
    setValues((previous) => (previous ? { ...previous, [key]: value } : previous));
  const link = page ? publicShopUrl(page.path) : "";
  return (
    <main className="billing-page branding-page shop-page-admin">
      <h1>Shop page</h1>
      <p>
        Your store’s own public page with your branding, shop photos and in-stock catalogue.
        Customers tap “Try it on” to contact you and book a virtual try-on. Editing the page uses no
        AI credits.
      </p>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {page && values && (
        <>
          <section>
            <h2>{page.published ? "Your page is live" : "Your page is not published yet"}</h2>
            <p>
              <a href={link} target="_blank" rel="noreferrer">
                {link}
              </a>
            </p>
            <p>
              {page.published
                ? "Share this link on WhatsApp, Instagram or a QR code at the counter."
                : "Only signed-in staff of this store can preview it. The owner can publish it below."}
            </p>
            <p>
              Name, logo, colour, phone, address and map link come from{" "}
              {owner ? <a href="/branding">Branding</a> : "Branding"}.
            </p>
          </section>
          {editor ? (
            <>
              <section>
                <h2>Page content</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save();
                  }}
                >
                  {owner && (
                    <>
                      <label>
                        Page address
                        <input
                          required
                          minLength={3}
                          maxLength={40}
                          pattern="[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?"
                          value={values.slug}
                          disabled={busy}
                          onChange={(e) => update("slug", e.target.value.toLowerCase())}
                        />
                      </label>
                      <p>
                        Lowercase letters, numbers and hyphens. Changing it breaks links you already
                        shared.
                      </p>
                      <label className="consent">
                        <input
                          type="checkbox"
                          checked={values.published}
                          disabled={busy}
                          onChange={(e) => update("published", e.target.checked)}
                        />
                        <span>Publish the page so anyone with the link can see it</span>
                      </label>
                    </>
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
                      type="tel"
                      maxLength={40}
                      placeholder="+91 98765 43210"
                      value={values.whatsapp}
                      disabled={busy}
                      onChange={(e) => update("whatsapp", e.target.value)}
                    />
                  </label>
                  <p>
                    Include the country code. Without a WhatsApp number, “Try it on” calls the store
                    phone from Branding.
                  </p>
                  <label className="consent">
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
                  <button className="button primary" disabled={busy}>
                    {busy ? "Saving…" : "Save shop page"}
                  </button>
                </form>
              </section>
              <section>
                <h2>
                  Shop photos ({page.photos.length}/{page.photoLimit})
                </h2>
                <p>
                  The first photo is the large cover image. JPEG, PNG or WebP up to 5 MB; location
                  data is removed when the photo is saved.
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
                            value={captions[photo.id] ?? ""}
                            disabled={busy}
                            onChange={(e) =>
                              setCaptions((c) => ({ ...c, [photo.id]: e.target.value }))
                            }
                          />
                        </label>
                        <div className="shop-photo-actions">
                          <button
                            className="button secondary"
                            disabled={busy || (captions[photo.id] ?? "") === photo.caption}
                            onClick={() =>
                              void run(
                                () =>
                                  catalogueApi(
                                    `/api/shop-page/photos/${photo.id}`,
                                    json("PATCH", { caption: captions[photo.id] ?? "" }),
                                  ),
                                "Caption saved.",
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
            </>
          ) : (
            <p>Only the owner or a manager can edit the shop page.</p>
          )}
        </>
      )}
    </main>
  );
}
