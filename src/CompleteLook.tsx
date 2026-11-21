import { useEffect, useRef, useState } from "react";
import { loadImage } from "./images";
import { jewelleryApi, downloadJewellery, type PreviewMode } from "./jewellery-api";
import { previewLabel } from "./jewellery-overlay";
import ShareLook from "./ShareLook";
type Look = { id: string; avatarId: string; name: string; view: string; itemsJson: unknown[] };
type Prepared = {
  sourceHash: string;
  outfit: string;
  portrait: string;
  previewMode: PreviewMode;
  layout: {
    width: number;
    height: number;
    bodyHeight: number;
    inset: { x: number; y: number; width: number; height: number; radius: number };
    text: { text: string; x: number; y: number }[];
    preview: string;
    previewLines?: string[];
    fonts?: { title: number; item: number; preview: number };
  };
};
async function composite(p: Prepared) {
  const [outfit, portrait] = await Promise.all([loadImage(p.outfit), loadImage(p.portrait)]),
    l = p.layout,
    b = l.inset,
    canvas = document.createElement("canvas");
  canvas.width = l.width;
  canvas.height = l.height;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#fff";
  c.fillRect(0, 0, l.width, l.height);
  c.drawImage(outfit, 0, 0, l.width, l.bodyHeight);
  c.fillStyle = "#fff";
  c.beginPath();
  c.roundRect(b.x - 5, b.y - 5, b.width + 10, b.height + 10, b.radius + 5);
  c.fill();
  c.save();
  c.beginPath();
  c.roundRect(b.x, b.y, b.width, b.height, b.radius);
  c.clip();
  c.drawImage(portrait, b.x, b.y, b.width, b.height);
  c.restore();
  c.fillStyle = "#294b3c";
  c.font = "bold " + (l.fonts?.title || 38) + "px sans-serif";
  c.fillText("Complete look", 28, l.bodyHeight + 64);
  c.font = (l.fonts?.item || 30) + "px sans-serif";
  for (const t of l.text) c.fillText(t.text, t.x, t.y);
  c.font = (l.fonts?.preview || 25) + "px sans-serif";
  const previewLines = l.previewLines || [l.preview];
  previewLines.forEach((line, i) =>
    c.fillText(line, 28, l.height - 36 - (previewLines.length - 1 - i) * 44),
  );
  const result = canvas.toDataURL("image/png");
  canvas.width = canvas.height = 0;
  return result;
}
export default function CompleteLook() {
  const params = new URLSearchParams(location.search),
    [avatar, setAvatar] = useState(params.get("avatar") || ""),
    [avatars, setAvatars] = useState<{ id: string; name: string }[]>([]),
    [looks, setLooks] = useState<Look[]>([]),
    [outfit, setOutfit] = useState(""),
    [portrait, setPortrait] = useState(""),
    [enabled, setEnabled] = useState<boolean | null>(null),
    [session, setSession] = useState(false),
    [prepared, setPrepared] = useState<Prepared | null>(null),
    [image, setImage] = useState(""),
    [mode, setMode] = useState<PreviewMode>("ai"),
    [name, setName] = useState("Customer complete look"),
    [reviewed, setReviewed] = useState(false),
    [storage, setStorage] = useState(false),
    [saved, setSaved] = useState<string | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const epoch = useRef(0),
    alive = useRef(true),
    controller = useRef<AbortController | null>(null),
    identity = useRef(""),
    requested = useRef(params.get("look"));
  const valid = (n: number) => alive.current && epoch.current === n;
  function reset() {
    setPrepared(null);
    setImage("");
    setReviewed(false);
    setStorage(false);
    setSaved(null);
    setError("");
    setNotice("");
  }
  useEffect(() => {
    alive.current = true;
    let mounted = true;
    const boot = epoch.current;
    const expired = () => {
      epoch.current++;
      controller.current?.abort();
      identity.current = "";
      setSession(false);
      setBusy("");
      setAvatars([]);
      setLooks([]);
      reset();
      setError("Your store session ended or changed. Sign in from Forme and reopen this builder.");
    };
    const resume = () => {
      if (document.visibilityState !== "visible" || !identity.current) return;
      void jewelleryApi("/api/account")
        .then((d) => {
          if (
            mounted &&
            identity.current &&
            d.account?.id + ":" + d.account?.user?.id !== identity.current
          )
            expired();
        })
        .catch(() => {
          if (mounted) expired();
        });
    };
    window.addEventListener("forme-account-expired", expired);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    void (async () => {
      try {
        const health = await jewelleryApi("/api/health");
        if (!mounted || epoch.current !== boot) return;
        setEnabled(health.jewelleryCatalogueAvailable === true);
        if (!health.jewelleryCatalogueAvailable) return;
        const account = await jewelleryApi("/api/account");
        if (!account.account) throw new Error("Sign in from Forme to open saved looks.");
        const list = await jewelleryApi("/api/avatars");
        if (!mounted || epoch.current !== boot) return;
        identity.current = account.account.id + ":" + account.account.user.id;
        setSession(true);
        setAvatars(list.avatars);
        if (!avatar && list.avatars[0]) setAvatar(list.avatars[0].id);
      } catch (e) {
        if (mounted) setError((e as Error).message);
      }
    })();
    return () => {
      mounted = false;
      alive.current = false;
      epoch.current++;
      controller.current?.abort();
      window.removeEventListener("forme-account-expired", expired);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  useEffect(() => {
    if (!session || !avatar) return;
    const version = ++epoch.current,
      abort = new AbortController();
    controller.current = abort;
    setBusy("Opening saved looks");
    setLooks([]);
    setOutfit("");
    setPortrait("");
    reset();
    void (async () => {
      try {
        const list = await jewelleryApi(
          "/api/looks?avatar=" + encodeURIComponent(avatar),
          undefined,
          abort.signal,
        );
        if (valid(version)) {
          setLooks(list.looks);
          setOutfit(
            list.looks.find((l: Look) => l.view === "full" && !l.itemsJson.length)?.id || "",
          );
          setPortrait(
            list.looks.find((l: Look) => l.view === "portrait" && l.itemsJson.length)?.id || "",
          );
        }
        if (requested.current) {
          const look = await jewelleryApi(
            "/api/jewellery/looks/" + encodeURIComponent(requested.current),
            undefined,
            abort.signal,
          );
          if (look.avatarId !== avatar || look.view !== "complete")
            throw new Error("Choose a complete look belonging to this avatar.");
          if (valid(version)) {
            setImage(look.image);
            setSaved(look.id);
            setMode(look.previewMode);
            setName(look.name);
          }
          requested.current = null;
        }
      } catch (e) {
        if (valid(version)) setError((e as Error).message);
      } finally {
        if (valid(version)) {
          setBusy("");
          controller.current = null;
        }
      }
    })();
    return () => abort.abort();
  }, [avatar, session]);
  async function action(
    label: string,
    fn: (signal: AbortSignal, version: number) => Promise<void>,
  ) {
    const version = ++epoch.current,
      abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn(abort.signal, version);
    } catch (e) {
      if (valid(version)) setError((e as Error).message);
    } finally {
      if (valid(version)) {
        setBusy("");
        controller.current = null;
      }
    }
  }
  const body = { avatarId: avatar, outfitLookId: outfit, portraitLookId: portrait };
  const build = () =>
    action("Building complete preview", async (signal, v) => {
      reset();
      const data: Prepared = await jewelleryApi("/api/jewellery/complete/prepare", body, signal),
        value = await composite(data);
      if (valid(v)) {
        setPrepared(data);
        setImage(value);
        setMode(data.previewMode);
        setNotice(
          "Complete preview ready — no AI credit used. Review both references and the item names.",
        );
      }
    });
  const save = () =>
    action("Saving complete look", async (signal, v) => {
      const data = await jewelleryApi(
        "/api/jewellery/complete",
        { ...body, sourceHash: prepared!.sourceHash, name, reviewed: true, storageConsent: true },
        signal,
      );
      if (valid(v)) {
        setSaved(data.id);
        setImage(data.image);
        setStorage(false);
        setNotice("Complete look saved to this avatar. Reopen, export or share it without AI.");
      }
    });
  const download = () =>
    action("Preparing complete PNG", async (signal, v) => {
      await downloadJewellery(image, "complete", signal, () => valid(v), mode);
      if (valid(v)) setNotice("Full-resolution complete look downloaded.");
    });
  return (
    <main className="billing-page complete-look">
      <nav>
        <a href={"/jewellery?avatar=" + encodeURIComponent(avatar)}>Jewellery studio</a>
      </nav>
      <span className="eyebrow">THE WHOLE LOOK</span>
      <h1>Outfit and jewellery, together.</h1>
      <p>
        Combine a saved outfit with a saved jewellery portrait of the same customer. Creating this
        board uses no AI credits.
      </p>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {enabled === null && <p role="status">Checking availability…</p>}
      {enabled === false && <p>Complete looks are not enabled on this studio.</p>}
      {enabled && session && (
        <>
          <label>
            Complete look customer
            <select
              aria-label="Complete look customer"
              disabled={!!busy}
              value={avatar}
              onChange={(e) => {
                reset();
                setLooks([]);
                requested.current = null;
                setAvatar(e.target.value);
              }}
            >
              {avatars.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <div className="complete-layout">
            <section>
              <h2>Saved references</h2>
              <label>
                Saved clothing look
                <select
                  aria-label="Saved clothing look"
                  value={outfit}
                  disabled={!!busy}
                  onChange={(e) => {
                    setOutfit(e.target.value);
                    reset();
                  }}
                >
                  <option value="">Choose an outfit</option>
                  {looks
                    .filter((l) => l.view === "full" && !l.itemsJson.length)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Saved jewellery portrait
                <select
                  aria-label="Saved jewellery portrait"
                  value={portrait}
                  disabled={!!busy}
                  onChange={(e) => {
                    setPortrait(e.target.value);
                    reset();
                  }}
                >
                  <option value="">Choose a portrait look</option>
                  {looks
                    .filter((l) => l.view === "portrait" && l.itemsJson.length)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </label>
              {(!outfit || !portrait) && (
                <p>
                  Save a clothing look in Try clothes and a portrait jewellery look in the Jewellery
                  studio first.
                </p>
              )}
              <button
                className="button secondary full-width"
                disabled={!!busy || !outfit || !portrait}
                onClick={() => void build()}
              >
                Build complete look — free
              </button>
              {image && (
                <>
                  <label>
                    Complete look name
                    <input
                      value={name}
                      maxLength={60}
                      disabled={!!busy}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label className="consent">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={!!busy}
                      onChange={(e) => {
                        setReviewed(e.target.checked);
                        setStorage(false);
                      }}
                    />
                    <span>
                      I reviewed the outfit, customer portrait, jewellery and item names in this
                      complete look.
                    </span>
                  </label>
                  {prepared && (
                    <>
                      <label className="consent">
                        <input
                          type="checkbox"
                          checked={storage}
                          disabled={!!busy || !reviewed}
                          onChange={(e) => setStorage(e.target.checked)}
                        />
                        <span>
                          The customer agrees to save this complete look to the store account.
                        </span>
                      </label>
                      <button
                        className="button primary full-width"
                        disabled={!!busy || !reviewed || !storage || !name.trim()}
                        onClick={() => void save()}
                      >
                        Save complete look
                      </button>
                    </>
                  )}
                  <button
                    className="button secondary full-width"
                    disabled={!!busy || !reviewed}
                    onClick={() => void download()}
                  >
                    Download complete look PNG
                  </button>
                  {saved && reviewed && (
                    <ShareLook key={saved} kind="complete" lookId={saved} disabled={!!busy} />
                  )}
                </>
              )}
            </section>
            <section>
              {image ? (
                <>
                  <img
                    className="complete-preview"
                    src={image}
                    alt="Complete outfit and jewellery preview"
                  />
                  <p>
                    {previewLabel(mode)} · Approximate visual styling; not a physical fit
                    measurement.
                  </p>
                </>
              ) : (
                <p>
                  Your complete-look board appears here after selecting the two saved references.
                </p>
              )}
            </section>
          </div>
          {busy && (
            <div className="jewellery-working" role="status">
              {busy}…
              <button
                className="button secondary"
                onClick={() => {
                  epoch.current++;
                  controller.current?.abort();
                  setBusy("");
                  setNotice("Composition stopped. No AI request was made.");
                }}
              >
                Cancel request
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
