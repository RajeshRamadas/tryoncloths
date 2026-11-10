import TryOnTabs from "./TryOnTabs";
import { ExportBrandingChoice } from "./branding";
import SizeSuggestion from "./SizeSuggestion";
import PurchaseLook from "./PurchaseLook";
import ShareLook from "./ShareLook";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, RotateCcw, Shirt, Undo2, Upload } from "lucide-react";
import {
  baseAvatar,
  buildGarmentLayer,
  garmentSource,
  importGarment,
  renderOutfit,
  sampleCatalogue,
  type Category,
  type CutoutSettings,
  type Garment,
  type Layer,
  type LayerSource,
  type Placement,
} from "./outfits";
import { CUTOUT_MAX_TOLERANCE, CUTOUT_MIN_TOLERANCE } from "./jewellery-cutout";
import { SAMPLE_OUTFITS } from "./sample-wardrobe";
import { downloadAvatar } from "./images";
import { isNative } from "./native";
import LinkTryOn from "./LinkTryOn";
import { saveLook } from "./account-avatars";
import { type OpenedLook } from "./saved-avatars";
import { saveAdaptation, type Adaptation } from "./store-garments";

const categoryNames = { shirt: "Shirts & tops", trousers: "Trousers", shoes: "Shoes" };
const layerNames = { shirt: "top", trousers: "trousers", shoes: "shoes" };
const originalNames = { shirt: "Original top", trousers: "Original bottoms", shoes: "Bare feet" };

function GarmentThumbnail({ garment }: { garment: Garment }) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSource("");
    setFailed(false);
    garmentSource(garment)
      .then((value) => {
        if (!cancelled) setSource(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [garment]);
  return source ? (
    <img src={source} alt="" />
  ) : (
    <span className="garment-placeholder" aria-hidden="true">
      {failed ? "Preview unavailable" : "Loading…"}
    </span>
  );
}

type Props = {
  active: boolean;
  templateTone?: string;
  catalogueEnabled?: boolean;
  jewelleryEnabled?: boolean;
  customerId?: string | null;
  avatarId?: string | null;
  openedLook?: OpenedLook;
  profile: { id: string; name: string; index: number };
  personalized: string | null;
  tryOn: { available: boolean; providerLabel: string };
  onBack: () => void;
  onBusy: (busy: boolean) => void;
};
type Dressed = {
  image: string;
  label: string;
  previousLayers: Layer[];
  adaptation?: Adaptation;
  adaptationSaved?: boolean;
  fromSavedLook?: boolean;
};
export default function OutfitStudio({
  active,
  templateTone = "medium",
  catalogueEnabled = false,
  jewelleryEnabled = false,
  customerId,
  avatarId,
  openedLook,
  profile,
  personalized,
  tryOn,
  onBack,
  onBusy,
}: Props) {
  const catalogue = useMemo(
    () => sampleCatalogue(profile.id, !!personalized),
    [profile.id, personalized],
  );
  const [sessionId] = useState(() => crypto.randomUUID());
  const [imports, setImports] = useState<Garment[]>([]);
  // Decoded originals of imported photos, so the cut-out can be re-run on this device.
  const importSources = useRef(new Map<string, LayerSource>());
  const [layers, setLayers] = useState<Layer[]>([]);
  const [category, setCategory] = useState<Category>("shirt");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<"samples" | "products">(
    catalogue.length ? "samples" : "products",
  );
  const [base, setBase] = useState("");
  const [template, setTemplate] = useState("");
  // AI try-on results stack on the avatar; each one becomes the next base.
  const [dressed, setDressed] = useState<Dressed[]>(
    openedLook
      ? [
          {
            image: openedLook.image,
            label: openedLook.name,
            previousLayers: [],
            fromSavedLook: true,
          },
        ]
      : [],
  );
  const current = dressed.at(-1)?.image || base;
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(true);
  const [lookName, setLookName] = useState(openedLook?.name || "Customer outfit");
  const [savedLook, setSavedLook] = useState<string | null>(openedLook?.id || null);
  const [storageConsent, setStorageConsent] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [exportFooter, setExportFooter] = useState<boolean | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const selected = layers.find((item) => item.garment.category === category);
  const sampleMatches = catalogue.filter(
    (g) => g.category === category && g.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const combinations = (["shirt", "trousers", "shoes"] as Category[]).reduce(
    (total, c) => total * catalogue.filter((g) => g.category === c).length,
    1,
  );
  const lastAdaptation = dressed.at(-1);
  const canSaveAdaptation = Boolean(
    avatarId &&
    lastAdaptation?.adaptation?.reuseReceipt &&
    lastAdaptation.adaptation.garmentId &&
    !layers.length &&
    !lastAdaptation.adaptationSaved,
  );
  useEffect(() => {
    if (active) heading.current?.focus();
  }, [active]);
  useEffect(() => {
    let cancelled = false;
    baseAvatar(profile.index, personalized, templateTone)
      .then((value) => {
        if (!cancelled) setBase(value);
      })
      .then(() => (personalized ? baseAvatar(profile.index, null, templateTone) : ""))
      .then((value) => {
        // The standard template the placements were made against, for fitting to the pose.
        if (!cancelled) setTemplate(value);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setRendering(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profile.index, personalized, templateTone]);
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setRendering(true);
    setResult("");
    renderOutfit(current, layers, template ? { template, personalized: !!personalized } : undefined)
      .then((canvas) => {
        if (!cancelled) {
          setResult(canvas.toDataURL("image/png"));
          setRendering(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setRendering(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [current, layers, template]);
  function dress(image: string, label: string, adaptation?: Adaptation) {
    // Sample layers were included in the AI input, so they are now part of the image.
    setDressed((items) => [...items, { image, label, previousLayers: layers, adaptation }]);
    update([]);
    setNotice(
      adaptation?.reuseWarning ||
        (adaptation?.reused
          ? "Saved adaptation reused without an AI request. Review it before keeping this look."
          : "Try-on created. Check the face, body and garment before keeping this look."),
    );
  }
  function undoDress() {
    const previous = dressed.at(-1);
    if (!previous) return;
    setDressed((items) => items.slice(0, -1));
    update(previous.previousLayers);
    if (previous.previousLayers.length) setSource("samples");
  }
  function update(next: Layer[]) {
    setSavedLook(null);
    setStorageConsent(false);
    setLayers(next);
    setReviewed(false);
    setError("");
    setNotice("");
    setRendering(true);
  }
  function select(garment: Garment) {
    update([
      ...layers.filter((l) => l.garment.category !== category),
      {
        garment,
        placement: { ...garment.placement },
        // Imported tops are flat product shapes, so the arms go in front by default.
        armsInFront: !!garment.imported && garment.category === "shirt",
        fitToPose: !!garment.imported,
      },
    ]);
  }
  function selectOutfit(ids: readonly string[]) {
    const garments = ids.map((id) => catalogue.find((g) => g.id === id));
    if (garments.some((g) => !g)) return;
    update(
      garments.map((garment) => ({ garment: garment!, placement: { ...garment!.placement } })),
    );
    setSearch("");
    setCategory("shirt");
  }
  function adjust(field: keyof Placement, value: number) {
    update(
      layers.map((l) =>
        l.garment.category === category
          ? { ...l, placement: { ...l.placement, [field]: value / 100 } }
          : l,
      ),
    );
  }
  async function upload(file?: File) {
    if (!file) return;
    if (imports.length >= 12) {
      setError("Remove an imported layer before adding more. This session holds up to 12 layers.");
      return;
    }
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const { garment, source } = await importGarment(file, category, profile.id, !!personalized);
      if (source.photo) importSources.current.set(garment.id, source);
      setImports((items) => [...items, garment]);
      select(garment);
      if (garment.cutout)
        setNotice("Background removed on this device. Check the edges and placement.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  function recut(garment: Garment, cutout: CutoutSettings) {
    const source = importSources.current.get(garment.id);
    if (!source) return;
    try {
      const next = buildGarmentLayer(
        source,
        { id: garment.id, name: garment.name, category: garment.category },
        profile.id,
        !!personalized,
        cutout,
      );
      setImports((items) => items.map((g) => (g.id === next.id ? next : g)));
      update(
        layers.map((l) =>
          l.garment.id === next.id ? { ...l, garment: next, placement: { ...next.placement } } : l,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function keepLook() {
    if (
      !avatarId ||
      !result ||
      !reviewed ||
      !storageConsent ||
      !lookName.trim() ||
      busy ||
      rendering
    )
      return;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const restored = dressed[0]?.fromSavedLook;
      const garmentIds = [
        ...new Set([
          ...(restored ? openedLook?.garmentIds || [] : []),
          ...dressed.flatMap((d) => (d.adaptation?.garmentId ? [d.adaptation.garmentId] : [])),
        ]),
      ];
      const labels = [
        ...(restored ? openedLook?.garments || [] : []),
        ...dressed.slice(restored ? 1 : 0).map((x) => x.label),
        ...layers.map((x) => x.garment.name),
      ].map((x) => x.slice(0, 120));
      const saved = await saveLook(result, avatarId, lookName, labels, { sessionId, garmentIds });
      setSavedLook(saved.id);
      setNotice("Look saved to your store account. Open it under this avatar in Saved avatars.");
      if (canSaveAdaptation) {
        try {
          await persistAdaptation();
          setNotice(
            "Look and adaptation saved. This exact starting outfit and garment can now reuse the result without AI.",
          );
        } catch (e) {
          setError(`The look was saved, but automatic reuse was not: ${(e as Error).message}`);
        }
      }
      setStorageConsent(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  async function persistAdaptation() {
    if (!lastAdaptation?.adaptation?.garmentId || !lastAdaptation.adaptation.reuseReceipt) return;
    await saveAdaptation(
      lastAdaptation.adaptation.garmentId,
      lastAdaptation.image,
      lastAdaptation.adaptation.reuseReceipt,
    );
    setDressed((items) =>
      items.map((item) => (item === lastAdaptation ? { ...item, adaptationSaved: true } : item)),
    );
  }
  async function keepAdaptation() {
    if (!canSaveAdaptation || !reviewed || !storageConsent || busy || rendering) return;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await persistAdaptation();
      setStorageConsent(false);
      setNotice(
        "Adaptation saved for reuse. Select this garment with the same starting avatar and outfit to reuse it without AI.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  async function save() {
    if (!reviewed || !result || rendering || busy) return;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const saved = await downloadAvatar(
        profile.index,
        result,
        `${profile.id}-outfit`,
        templateTone,
        catalogueEnabled ? { storeFooter: exportFooter } : undefined,
      );
      setNotice(
        saved ? "Outfit PNG prepared. Your original avatar is unchanged." : "Export cancelled.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  const exportPanel = (
    <section className="outfit-panel outfit-export-panel">
      <h2>Keep this look</h2>
      <label className="consent">
        <input
          type="checkbox"
          checked={reviewed}
          disabled={busy || rendering || !result || (!layers.length && !dressed.length)}
          onChange={(e) => setReviewed(e.target.checked)}
        />
        <span>I have checked clothing placement and approve this outfit preview.</span>
      </label>
      {catalogueEnabled && <ExportBrandingChoice onChange={setExportFooter} />}
      <button
        className="button primary full-width"
        disabled={!reviewed || !result || rendering || busy || (!layers.length && !dressed.length)}
        onClick={() => void save()}
      >
        <Download size={17} />
        {busy ? "Preparing…" : isNative ? "Save or share outfit" : "Download outfit"}
      </button>
      {avatarId && (
        <div className="save-avatar-box">
          <label>
            Look name
            <input
              maxLength={60}
              value={lookName}
              disabled={busy}
              onChange={(e) => setLookName(e.target.value)}
            />
          </label>
          <label className="consent">
            <input
              type="checkbox"
              checked={storageConsent}
              disabled={!reviewed || busy || rendering}
              onChange={(e) => setStorageConsent(e.target.checked)}
            />
            <span>The customer agrees to save this outfit to the store account.</span>
          </label>
          {canSaveAdaptation && (
            <button
              className="button secondary full-width"
              disabled={!reviewed || !storageConsent || busy || rendering}
              onClick={() => void keepAdaptation()}
            >
              Save adaptation for reuse
            </button>
          )}
          {lastAdaptation?.adaptationSaved && <p role="status">Adaptation saved for reuse.</p>}
          <button
            className="button secondary full-width"
            disabled={
              !reviewed || !storageConsent || !result || busy || rendering || !lookName.trim()
            }
            onClick={() => void keepLook()}
          >
            Save look to account
          </button>
        </div>
      )}
      <button
        className="button back-button full-width"
        disabled={busy || (!layers.length && !dressed.length)}
        onClick={() => {
          setDressed([]);
          update([]);
        }}
      >
        <RotateCcw size={16} /> Reset outfit
      </button>
      {jewelleryEnabled && savedLook && avatarId && (
        <a
          className="button secondary"
          href={"/complete-look?avatar=" + encodeURIComponent(avatarId)}
        >
          Combine with jewellery portrait
        </a>
      )}
      {savedLook && (
        <PurchaseLook
          key={`purchase-${savedLook}`}
          lookId={savedLook}
          disabled={busy || rendering}
        />
      )}
      {savedLook && <ShareLook key={savedLook} lookId={savedLook} disabled={busy || rendering} />}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
  return (
    <section className="outfit-studio" hidden={!active} aria-label="Clothing try-on">
      <header className="outfit-header">
        <button className="button secondary" disabled={busy} onClick={onBack}>
          <ArrowLeft size={17} /> Back to avatar
        </button>
        {jewelleryEnabled && avatarId && (
          <TryOnTabs current="clothes" avatarId={avatarId} disabled={busy} />
        )}
        <span className="outfit-free">Sample clothes: free · Product try-on: AI credits</span>
      </header>
      <div className="outfit-intro">
        <span className="eyebrow">YOUR FITTING ROOM</span>
        <h1 ref={heading} tabIndex={-1}>
          Try a new look.
        </h1>
        <p>Choose clothes, check the preview, then save your favourite look.</p>
      </div>
      <nav className="fitting-mobile-nav" aria-label="Fitting room shortcuts">
        <a href="#outfit-choices">Choose clothes</a>
        <a href="#outfit-result">View avatar & save</a>
      </nav>
      <div className="outfit-layout">
        <div className="outfit-preview-card" id="outfit-result">
          <div className="outfit-preview-title">
            <strong>
              {profile.name} · {personalized ? "Customer avatar" : "Sample avatar"}
            </strong>
            <span>Outfit preview</span>
          </div>
          <div className="outfit-preview" aria-busy={rendering}>
            {result && <img src={result} alt="Avatar wearing the selected outfit" />}
            {rendering && (
              <span className="outfit-rendering" role="status">
                Updating preview…
              </span>
            )}
          </div>
          {active && customerId && !layers.length && lastAdaptation?.adaptation?.garmentId && (
            <SizeSuggestion
              key={`${customerId}-${lastAdaptation.adaptation.garmentId}`}
              customerId={customerId}
              garmentId={lastAdaptation.adaptation.garmentId}
            />
          )}
          <p className="outfit-selected-items">
            {layers.length
              ? layers.map((l) => l.garment.name).join(" · ")
              : dressed.length
                ? "Your look is ready to review."
                : "Choose your first item to begin."}
          </p>
          <p className="outfit-caption">
            Approximate visual styling. This preview does not predict size, fit or fabric drape.
          </p>
          {exportPanel}
        </div>
        <div className="outfit-controls" id="outfit-choices">
          <div className="fitting-source" role="group" aria-label="Clothing source">
            <button
              aria-label={catalogue.length ? "Sample clothes" : "Prepared layers"}
              aria-pressed={source === "samples"}
              disabled={busy}
              onClick={() => setSource("samples")}
            >
              <strong>{catalogue.length ? "Sample clothes" : "Prepared layers"}</strong>
              <span aria-hidden="true">
                {catalogue.length
                  ? `Free · ${catalogue.length} styles`
                  : "Import clothes or product photos · free"}
              </span>
            </button>
            <button
              aria-label="Your products"
              aria-pressed={source === "products"}
              disabled={busy}
              onClick={() => setSource("products")}
            >
              <strong>Your products</strong>
              <span aria-hidden="true">Photo, link or saved catalogue</span>
            </button>
          </div>
          <div hidden={source !== "samples"} className="fitting-source-panel">
            {catalogue.length > 0 && (
              <details className="outfit-panel sample-outfits">
                <summary>
                  <h2>Complete outfit combinations</h2>
                  <span>8 ready-made looks</span>
                </summary>
                <p>
                  {catalogue.length} sample items · {combinations.toLocaleString("en-IN")} possible
                  combinations. Try a complete look, or mix individual pieces below. No AI credits
                  used.
                </p>
                <div
                  className="sample-outfit-grid"
                  role="group"
                  aria-label="Complete sample outfits"
                >
                  {SAMPLE_OUTFITS.map((outfit) => (
                    <button
                      key={outfit.id}
                      disabled={busy}
                      aria-pressed={
                        layers.length === 3 &&
                        outfit.garments.every((id) => layers.some((l) => l.garment.id === id))
                      }
                      onClick={() => selectOutfit(outfit.garments)}
                    >
                      <span className="outfit-swatches" aria-hidden="true">
                        {outfit.garments.map((id) => {
                          const g = catalogue.find((item) => item.id === id)!;
                          return <GarmentThumbnail key={id} garment={g} />;
                        })}
                      </span>
                      <strong>{outfit.name}</strong>
                      <small>
                        {outfit.garments
                          .map((id) => catalogue.find((item) => item.id === id)!.name)
                          .join(" · ")}
                      </small>
                    </button>
                  ))}
                </div>
              </details>
            )}
            <section className="outfit-panel">
              <h2>
                <Shirt size={20} /> Choose your clothes
              </h2>
              <p>
                {profile.id.startsWith("f-")
                  ? "Use product-photo try-on or import prepared layers. Female sample garments are being prepared."
                  : "Pick a top, trousers and shoes. Switch colours as often as you like — no AI credits used."}
              </p>
              <div className="outfit-tabs" role="group" aria-label="Clothing category">
                {(["shirt", "trousers", "shoes"] as Category[]).map((c) => (
                  <button
                    key={c}
                    disabled={busy}
                    aria-pressed={category === c}
                    onClick={() => setCategory(c)}
                  >
                    {categoryNames[c]}
                  </button>
                ))}
              </div>
              {catalogue.length > 0 && (
                <label className="outfit-search">
                  Search sample clothes
                  <input
                    type="search"
                    placeholder="Try navy, jeans or sneakers"
                    value={search}
                    disabled={busy}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              )}
              {catalogue.length > 0 && (
                <p className="sample-match-count" role="status">
                  {sampleMatches.length} sample {layerNames[category]} options
                  {search.trim() ? ` matching “${search.trim()}”` : ""}.
                  {sampleMatches.length > 6 ? " Scroll to see more colours." : ""} Imported layers
                  stay available below.
                </p>
              )}
              <div className="garment-grid" tabIndex={0} role="group" aria-label="Clothing options">
                <button
                  className="garment-tile"
                  disabled={busy}
                  aria-pressed={!selected}
                  onClick={() => update(layers.filter((l) => l.garment.category !== category))}
                >
                  <span className="garment-original">
                    <RotateCcw />
                  </span>
                  <strong>{originalNames[category]}</strong>
                </button>
                {[...sampleMatches, ...imports.filter((g) => g.category === category)].map((g) => (
                  <button
                    key={g.id}
                    className="garment-tile"
                    disabled={busy}
                    aria-pressed={selected?.garment.id === g.id}
                    onClick={() => select(g)}
                  >
                    <GarmentThumbnail garment={g} />
                    <strong>{g.name}</strong>
                    <small>{g.imported ? "Your layer" : "Sample"}</small>
                  </button>
                ))}
              </div>
              {catalogue.length > 0 && sampleMatches.length === 0 && (
                <p>
                  No sample clothes match this search in {categoryNames[category].toLowerCase()}.
                  Try another colour or category, or{" "}
                  <button className="text-button" onClick={() => setSearch("")} disabled={busy}>
                    Clear sample search
                  </button>
                  .
                </p>
              )}
              <details className="import-clothing">
                <summary>Import a clothing layer or product photo</summary>
                <input
                  ref={input}
                  type="file"
                  accept="image/png,image/webp,image/jpeg"
                  aria-label="Import clothing layer"
                  className="outfit-file"
                  disabled={busy}
                  onChange={(e) => {
                    void upload(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <button
                  className="button secondary full-width"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  <Upload size={16} /> Import {layerNames[category]} layer
                </button>
                <p className="small-footnote">
                  A transparent PNG or WebP layer, or a front-view product photo on a plain backdrop
                  (JPEG, PNG or WebP), whose background is removed on this device. Import footwear
                  as a pair. Layers line up with the neckline, waistband or feet and stay in this
                  session. Garments are not reshaped to the pose.
                </p>
              </details>
            </section>
          </div>
          <div hidden={source !== "products"} className="fitting-source-panel">
            <LinkTryOn
              sessionId={sessionId}
              catalogueEnabled={catalogueEnabled}
              avatarId={avatarId}
              bodyType={profile.id.startsWith("f-") ? "female" : "male"}
              base={result}
              disabled={busy || rendering}
              available={tryOn.available}
              providerLabel={tryOn.providerLabel}
              onBusy={(value) => {
                setBusy(value);
                onBusy(value);
              }}
              onResult={dress}
            />
          </div>
          {dressed.length > 0 && (
            <section className="outfit-panel">
              <h2>Current look</h2>
              <ol className="dressed-list">
                {dressed.map((item, index) => (
                  <li key={index}>{item.label}</li>
                ))}
              </ol>
              <button className="button secondary" disabled={busy} onClick={undoDress}>
                <Undo2 size={16} /> Undo last garment
              </button>
            </section>
          )}
          {selected && (
            <details className="outfit-panel placement-options">
              <summary>
                <h2>Adjust placement</h2>
                <span>Only if the fit needs a nudge</span>
              </summary>
              <p>
                Line up the neckline, waistband or shoes. Check that the original clothes are
                covered.
              </p>
              {(
                [
                  ["x", "Left / right", -30, 100],
                  ["y", "Up / down", -30, 100],
                  ["width", "Width", 5, 150],
                  ["height", "Length", 5, 150],
                ] as const
              ).map(([key, label, min, max]) => (
                <label className="outfit-slider" key={key}>
                  <span>
                    {label}
                    <output>{Math.round(selected.placement[key] * 100)}%</output>
                  </span>
                  <input
                    aria-label={`${category} ${label}`}
                    type="range"
                    min={min}
                    max={max}
                    step="0.5"
                    value={selected.placement[key] * 100}
                    disabled={busy}
                    onChange={(e) => adjust(key, Number(e.target.value))}
                  />
                </label>
              ))}
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => select(selected.garment)}
              >
                Reset placement
              </button>
              {personalized && selected.garment.imported && (
                <label className="consent">
                  <input
                    type="checkbox"
                    checked={!!selected.fitToPose}
                    disabled={busy}
                    onChange={(e) =>
                      update(
                        layers.map((l) =>
                          l === selected ? { ...l, fitToPose: e.target.checked } : l,
                        ),
                      )
                    }
                  />
                  <span>
                    Fit to this avatar’s pose. The layer follows where the generated body’s
                    shoulders, hips and ankles actually are.
                  </span>
                </label>
              )}
              {category === "shirt" && (
                <label className="consent">
                  <input
                    type="checkbox"
                    checked={!!selected.armsInFront}
                    disabled={busy}
                    onChange={(e) =>
                      update(
                        layers.map((l) =>
                          l === selected ? { ...l, armsInFront: e.target.checked } : l,
                        ),
                      )
                    }
                  />
                  <span>
                    Show forearms and hands in front of this top. Turn off for long sleeves that
                    already cover the arms.
                  </span>
                </label>
              )}
              {selected.garment.cutout && (
                <fieldset className="garment-cutout">
                  <legend>Background removal</legend>
                  <label className="outfit-slider">
                    <span>
                      Background tolerance
                      <output>{selected.garment.cutout.tolerance}</output>
                    </span>
                    <input
                      aria-label="Clothing background tolerance"
                      type="range"
                      min={CUTOUT_MIN_TOLERANCE}
                      max={CUTOUT_MAX_TOLERANCE}
                      step="4"
                      value={selected.garment.cutout.tolerance}
                      disabled={busy}
                      onChange={(e) =>
                        recut(selected.garment, {
                          ...selected.garment.cutout!,
                          tolerance: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="consent">
                    <input
                      type="checkbox"
                      checked={selected.garment.cutout.clearEnclosed}
                      disabled={busy}
                      onChange={(e) =>
                        recut(selected.garment, {
                          ...selected.garment.cutout!,
                          clearEnclosed: e.target.checked,
                        })
                      }
                    />
                    <span>Clear enclosed gaps, such as between straps</span>
                  </label>
                  <p className="small-footnote">
                    Raise the tolerance if backdrop remains; lower it if the garment edges are lost.
                    Changing these resets the placement.
                  </p>
                </fieldset>
              )}
              {selected.garment.imported && (
                <button
                  className="button back-button"
                  disabled={busy}
                  onClick={() => {
                    importSources.current.delete(selected.garment.id);
                    setImports((items) => items.filter((g) => g.id !== selected.garment.id));
                    update(layers.filter((l) => l !== selected));
                  }}
                >
                  Remove imported layer
                </button>
              )}
            </details>
          )}
        </div>
      </div>
    </section>
  );
}
