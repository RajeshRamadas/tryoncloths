import JewelleryVariantLink from "./JewelleryVariantLink";
import JewelleryOverlayUpload from "./JewelleryOverlayUpload";
import { useEffect, useRef, useState } from "react";
import { catalogueApi } from "./catalogue";
import { catalogueRequest } from "./store-garments";
import {
  jewelleryChoices,
  jewelleryMetals,
  bangleSizes,
  jewelleryView,
  jewelleryTypes,
  guessJewelleryType,
  type JewelleryType,
  type JewelleryAttributes,
} from "./jewellery-types";

type Item = {
  id: string;
  name: string;
  category: "jewellery";
  garmentType: JewelleryType;
  attributes: JewelleryAttributes;
  variant: string;
  sourceUrl: string;
  sku: string | null;
  priceInr: number | null;
  stock: string;
  thumbnail: string;
  readOnly: boolean;
  hasOverlay: boolean;
};
type Page = {
  garments: Item[];
  total: number;
  offset: number;
  limit: number;
  capacity: number;
  stored: number;
};
const numeric = [
  ["weightG", "Weight (g)", 0, 2000],
  ["lengthCm", "Chain / necklace length (cm)", 20, 120],
  ["dropMm", "Earring drop (mm)", 2, 150],
  ["pendantMm", "Pendant height (mm)", 5, 150],
  ["ringSizeIn", "Indian ring size", 1, 30],
  ["count", "Piece count", 1, 24],
] as const;
const empty = () => ({
  name: "",
  variant: "",
  sourceUrl: "",
  sku: "",
  price: "",
  stock: "in",
  metal: "",
  purity: "",
  stones: "",
  huid: "",
  bangleSize: "",
  weightG: "",
  lengthCm: "",
  dropMm: "",
  pendantMm: "",
  ringSizeIn: "",
  count: "",
});
export default function JewelleryCatalogue() {
  const [enabled, setEnabled] = useState<boolean | null>(null),
    [role, setRole] = useState(""),
    [data, setData] = useState<Page | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [draft, setDraft] = useState(empty),
    [type, setType] = useState<JewelleryType>("necklace"),
    [touched, setTouched] = useState(false),
    [pair, setPair] = useState(false),
    [image, setImage] = useState(""),
    [consent, setConsent] = useState(false),
    [editing, setEditing] = useState<Item | null>(null);
  const [search, setSearch] = useState(""),
    [filterType, setFilterType] = useState("all"),
    [metal, setMetal] = useState("all"),
    [stock, setStock] = useState("available");
  const photoVersion = useRef(0),
    manager = role === "owner" || role === "manager";
  const browse = async (offset = 0) => {
    const query = new URLSearchParams({
      category: "jewellery",
      search,
      type: filterType,
      metal,
      stock,
      offset: String(offset),
      limit: "50",
    });
    return catalogueApi("/api/catalogue?" + query) as Promise<Page>;
  };
  useEffect(() => {
    let alive = true;
    const expired = () => {
      setRole("");
      setData(null);
      setImage("");
      setEditing(null);
      setError("Your store session ended. Sign in again from Forme.");
    };
    window.addEventListener("forme-account-expired", expired);
    void (async () => {
      try {
        const health = await catalogueApi("/api/health");
        if (!alive) return;
        setEnabled(health.jewelleryCatalogueAvailable === true);
        if (!health.jewelleryCatalogueAvailable) return;
        const account = await catalogueApi("/api/account");
        if (!account.account) throw new Error("Sign in to your store account from Forme first.");
        const page = await catalogueApi("/api/catalogue?category=jewellery&limit=50");
        if (alive) {
          setRole(account.account.user.role);
          setData(page);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
      photoVersion.current++;
      window.removeEventListener("forme-account-expired", expired);
    };
  }, []);
  function reset() {
    photoVersion.current++;
    setDraft(empty());
    setType("necklace");
    setTouched(false);
    setPair(false);
    setImage("");
    setConsent(false);
    setEditing(null);
  }
  async function photo(file: File) {
    const version = ++photoVersion.current;
    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 5 * 1024 * 1024 ||
        !file.size
      )
        throw new Error("Use a JPEG, PNG or WebP product photo under 5 MB.");
      const value = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("The product photo could not be read."));
        reader.readAsDataURL(file);
      });
      if (version === photoVersion.current) {
        setImage(value);
        setError("");
      }
    } catch (e) {
      if (version === photoVersion.current) setError((e as Error).message);
    }
  }
  function attributes() {
    const value: Record<string, unknown> = {
      metal: draft.metal,
      pair,
      ...(editing?.attributes.variantOf ? { variantOf: editing.attributes.variantOf } : {}),
    };
    for (const key of ["purity", "stones", "huid", "bangleSize"] as const)
      if (draft[key]) value[key] = draft[key];
    for (const [key] of numeric) if (draft[key] !== "") value[key] = Number(draft[key]);
    return value as JewelleryAttributes;
  }
  async function save() {
    if (busy || !manager) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const attrs = attributes();
      if (editing) {
        await catalogueApi(
          "/api/catalogue/" + encodeURIComponent(editing.id) + "?category=jewellery",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              attributes: attrs,
              sku: draft.sku,
              priceInr: draft.price,
              stock: draft.stock,
            }),
          },
        );
        setNotice("Jewellery details saved.");
      } else {
        const result = await catalogueRequest("/api/garments", {
          category: "jewellery",
          name: draft.name,
          garmentType: type,
          attributes: attrs,
          variant: draft.variant,
          sourceUrl: draft.sourceUrl,
          sku: draft.sku,
          priceInr: draft.price,
          stock: draft.stock,
          image,
          storageConsent: consent,
        });
        setNotice(
          result.duplicate
            ? "This jewellery photo and variant are already saved."
            : "Jewellery item saved. No AI credits were used.",
        );
      }
      reset();
      setData(await browse());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(item: Item) {
    reset();
    setEditing(item);
    setType(item.garmentType);
    setTouched(true);
    setPair(item.attributes.pair ?? jewelleryTypes[item.garmentType].pair);
    setDraft({
      ...empty(),
      ...Object.fromEntries(
        Object.entries(item.attributes).map(([key, value]) => [key, String(value)]),
      ),
      name: item.name,
      variant: item.variant,
      sourceUrl: item.sourceUrl,
      sku: item.sku || "",
      price: item.priceInr == null ? "" : String(item.priceInr),
      stock: item.stock,
    });
    setNotice("");
    document.getElementById("jewellery-editor")?.scrollIntoView({ block: "start" });
  }
  async function remove(item: Item) {
    if (!window.confirm("Delete " + item.name + " from this store?")) return;
    setBusy(true);
    setError("");
    try {
      await catalogueRequest(
        "/api/garments/" + encodeURIComponent(item.id) + "?category=jewellery",
        undefined,
        "DELETE",
      );
      if (editing?.id === item.id) reset();
      setData(await browse());
      setNotice("Jewellery item deleted.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function load(offset = 0) {
    setBusy(true);
    setError("");
    try {
      setData(await browse(offset));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const viewName = (itemType: JewelleryType, length?: number) =>
    (({ portrait: "Portrait", hands: "Hands", full: "Full body" }) as Record<string, string>)[
      jewelleryView(itemType, length) || "full"
    ];
  return (
    <main className="billing-page jewellery-catalogue">
      <nav>
        <a href="/">Back to Forme</a> · <a href="/catalogue">Clothing catalogue</a> ·{" "}
        <a href="/jewellery">Jewellery studio</a>
      </nav>
      <h1>Jewellery catalogue</h1>
      <p>
        Save product photos, metal and dimensions for your store. Try saved pieces on approved
        avatar views in the Jewellery studio. Catalogue actions use no AI credits.
      </p>
      {enabled === null && <p role="status">Checking jewellery availability…</p>}
      {enabled === false && <p>Jewellery catalogue is not enabled on this studio.</p>}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {enabled && role && (
        <>
          {manager ? (
            <section id="jewellery-editor">
              <h2>{editing ? "Edit jewellery details" : "Add a jewellery item"}</h2>
              <form
                aria-label="Jewellery item"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <fieldset disabled={busy}>
                  <div className="catalogue-filters">
                    <label>
                      Item name
                      <input
                        required
                        maxLength={100}
                        value={draft.name}
                        disabled={Boolean(editing)}
                        onChange={(e) => {
                          const name = e.target.value;
                          setDraft((d) => ({ ...d, name }));
                          const guessed = guessJewelleryType(name);
                          if (!touched && guessed) {
                            setType(guessed);
                            setPair(jewelleryTypes[guessed].pair);
                          }
                        }}
                      />
                    </label>
                    <label>
                      Jewellery type
                      <select
                        value={type}
                        disabled={Boolean(editing)}
                        onChange={(e) => {
                          const value = e.target.value as JewelleryType;
                          setType(value);
                          setTouched(true);
                          setPair(jewelleryTypes[value].pair);
                        }}
                      >
                        {jewelleryChoices.map(([id, label]) => (
                          <option value={id} key={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Metal
                      <select
                        required
                        value={draft.metal}
                        onChange={(e) => setDraft((d) => ({ ...d, metal: e.target.value }))}
                      >
                        <option value="">Choose metal</option>
                        {jewelleryMetals.map(([id, label]) => (
                          <option value={id} key={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Metal / stone / SKU variant
                      <input
                        maxLength={80}
                        value={draft.variant}
                        disabled={Boolean(editing)}
                        onChange={(e) => setDraft((d) => ({ ...d, variant: e.target.value }))}
                      />
                    </label>
                    <label>
                      SKU
                      <input
                        maxLength={64}
                        value={draft.sku}
                        onChange={(e) => setDraft((d) => ({ ...d, sku: e.target.value }))}
                      />
                    </label>
                    <label>
                      Price (INR)
                      <input
                        type="number"
                        min="0"
                        max="10000000"
                        step="0.01"
                        value={draft.price}
                        onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                      />
                    </label>
                    <label>
                      Jewellery stock
                      <select
                        value={draft.stock}
                        onChange={(e) => setDraft((d) => ({ ...d, stock: e.target.value }))}
                      >
                        <option value="in">In stock</option>
                        <option value="low">Low stock</option>
                        <option value="out">Out of stock</option>
                      </select>
                    </label>
                    <label>
                      Product URL (optional)
                      <input
                        type="url"
                        maxLength={2048}
                        value={draft.sourceUrl}
                        disabled={Boolean(editing)}
                        onChange={(e) => setDraft((d) => ({ ...d, sourceUrl: e.target.value }))}
                      />
                    </label>
                  </div>
                  <details>
                    <summary>Dimensions and hallmark</summary>
                    <div className="catalogue-filters">
                      {numeric.map(([key, label, min, max]) => (
                        <label key={key}>
                          {label}
                          <input
                            type="number"
                            min={min}
                            max={max}
                            step={key === "ringSizeIn" || key === "count" ? "1" : "any"}
                            value={draft[key]}
                            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                          />
                        </label>
                      ))}
                      <label>
                        Purity
                        <input
                          maxLength={10}
                          value={draft.purity}
                          onChange={(e) => setDraft((d) => ({ ...d, purity: e.target.value }))}
                        />
                      </label>
                      <label>
                        Stones
                        <input
                          maxLength={80}
                          value={draft.stones}
                          onChange={(e) => setDraft((d) => ({ ...d, stones: e.target.value }))}
                        />
                      </label>
                      <label>
                        HUID / hallmark (display only)
                        <input
                          maxLength={12}
                          value={draft.huid}
                          onChange={(e) => setDraft((d) => ({ ...d, huid: e.target.value }))}
                        />
                      </label>
                      <label>
                        Indian bangle size
                        <select
                          value={draft.bangleSize}
                          onChange={(e) => setDraft((d) => ({ ...d, bangleSize: e.target.value }))}
                        >
                          <option value="">Not specified</option>
                          {bangleSizes.map((size) => (
                            <option key={size}>{size}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="consent">
                      <input
                        type="checkbox"
                        checked={pair}
                        onChange={(e) => setPair(e.target.checked)}
                      />
                      <span>Sold as a pair</span>
                    </label>
                  </details>
                  <p>
                    Suggested view: {viewName(type, Number(draft.lengthCm) || undefined)}.
                    Dimensions describe the product; they do not guarantee fit, scale or certified
                    appearance.
                  </p>
                  {!editing && (
                    <>
                      <label>
                        Product photo
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) void photo(file);
                          }}
                        />
                      </label>
                      {image && (
                        <img
                          className="inventory-photo"
                          src={image}
                          alt="Selected jewellery product"
                        />
                      )}
                      <label className="consent">
                        <input
                          type="checkbox"
                          required
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                        />
                        <span>
                          I confirm saving this product photo and its details to this store account.
                        </span>
                      </label>
                    </>
                  )}
                  <div className="customer-actions">
                    <button className="button primary" disabled={!editing && (!image || !consent)}>
                      {editing ? "Save jewellery details" : "Save jewellery item"}
                    </button>
                    <button className="button secondary" type="button" onClick={reset}>
                      {editing ? "Cancel jewellery edit" : "Clear item form"}
                    </button>
                  </div>
                </fieldset>
              </form>
            </section>
          ) : (
            <p>
              Staff can browse jewellery. Only owners and managers can add, edit or delete items.
            </p>
          )}
          <section>
            <h2>Saved jewellery</h2>
            <form
              className="catalogue-filters"
              onSubmit={(e) => {
                e.preventDefault();
                void load();
              }}
            >
              <label>
                Search jewellery
                <input
                  value={search}
                  maxLength={120}
                  disabled={busy}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label>
                Filter jewellery type
                <select
                  value={filterType}
                  disabled={busy}
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="all">All jewellery</option>
                  {jewelleryChoices.map(([id, label]) => (
                    <option value={id} key={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Filter metal
                <select value={metal} disabled={busy} onChange={(e) => setMetal(e.target.value)}>
                  <option value="all">All metals</option>
                  {jewelleryMetals.map(([id, label]) => (
                    <option value={id} key={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Jewellery stock filter
                <select value={stock} disabled={busy} onChange={(e) => setStock(e.target.value)}>
                  <option value="available">Available items</option>
                  <option value="all">All stock</option>
                  <option value="out">Out of stock</option>
                </select>
              </label>
              <button className="button secondary" disabled={busy}>
                Search saved jewellery
              </button>
            </form>
            {data && (
              <p>
                {data.total} jewellery items match · {data.stored} of {data.capacity} combined
                catalogue items used.
              </p>
            )}
            {data && !data.garments.length && <p>No jewellery matches these filters.</p>}
            <div className="catalogue-grid">
              {data?.garments.map((item) => (
                <article className="catalogue-item" key={item.id}>
                  <img className="inventory-photo" src={item.thumbnail} alt={item.name} />
                  <h3>{item.name}</h3>
                  <p>
                    {jewelleryChoices.find(([id]) => id === item.garmentType)?.[1]} ·{" "}
                    {jewelleryMetals.find(([id]) => id === item.attributes.metal)?.[1]}{" "}
                    {item.attributes.purity || ""}
                    {item.variant ? " · " + item.variant : ""}
                  </p>
                  {item.sku && <p>SKU {item.sku}</p>}
                  {item.priceInr != null && (
                    <p>
                      {new Intl.NumberFormat("en-IN", {
                        style: "currency",
                        currency: "INR",
                      }).format(item.priceInr)}
                    </p>
                  )}
                  <p>
                    {item.stock === "out"
                      ? "Out of stock"
                      : item.stock === "low"
                        ? "Low stock"
                        : "In stock"}{" "}
                    · {viewName(item.garmentType, item.attributes.lengthCm)} reference view
                  </p>
                  {item.hasOverlay && <p>Overlay ready · free placement</p>}
                  <dl>
                    {Object.entries(item.attributes)
                      .filter(([key]) => !["metal", "purity", "variantOf"].includes(key))
                      .map(([key, value]) => (
                        <div key={key}>
                          <dt>
                            {numeric.find(([id]) => id === key)?.[1] ||
                              (
                                {
                                  pair: "Sold as pair",
                                  huid: "HUID / hallmark",
                                  stones: "Stones",
                                  bangleSize: "Bangle size",
                                } as Record<string, string>
                              )[key] ||
                              key}
                          </dt>
                          <dd>
                            {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}
                          </dd>
                        </div>
                      ))}
                  </dl>
                  {item.readOnly ? (
                    <p>Shared master · Read-only</p>
                  ) : (
                    manager && (
                      <div className="customer-actions">
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => edit(item)}
                        >
                          Edit {item.name}
                        </button>
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => void remove(item)}
                        >
                          Delete {item.name}
                        </button>
                      </div>
                    )
                  )}
                  {manager && !item.readOnly && (
                    <JewelleryVariantLink
                      item={item}
                      onSaved={() => {
                        setNotice(
                          "Variant link updated. Approved visual adaptations are retained.",
                        );
                        void load(data?.offset || 0);
                      }}
                    />
                  )}
                  {manager && !item.readOnly && (
                    <JewelleryOverlayUpload
                      id={item.id}
                      type={item.garmentType}
                      hasOverlay={item.hasOverlay}
                      onSaved={() => {
                        setNotice("Catalogue cut-out updated. No AI credit used.");
                        void load(data?.offset || 0);
                      }}
                    />
                  )}
                </article>
              ))}
            </div>
            {data && (
              <div className="customer-actions">
                <button
                  className="button secondary"
                  disabled={busy || data.offset === 0}
                  onClick={() => void load(Math.max(0, data.offset - data.limit))}
                >
                  Previous jewellery
                </button>
                <button
                  className="button secondary"
                  disabled={busy || data.offset + data.limit >= data.total}
                  onClick={() => void load(data.offset + data.limit)}
                >
                  Next jewellery
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
