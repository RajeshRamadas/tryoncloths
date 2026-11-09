import CustomerHandPhoto, {
  HandPhotoMarkers,
  validHandPoints,
  type HandPoints,
} from "./CustomerHandPhoto";
import { useEffect, useRef, useState } from "react";
import { requestApi } from "./api";
import { catalogueApi } from "./catalogue";
import { skinTones } from "./profiles";
type Kind = "portrait" | "hands";
type Avatar = {
  id: string;
  name: string;
  thumbnail: string;
  bodyType: string;
  templateTone: string;
};
type Saved = {
  kind: Kind;
  tone: string;
  sourceKind: string;
  approvedAt: number;
  createdAt: number;
};
type Preview = {
  image: string;
  receipt: string;
  kind: Kind;
  sourceKind: string;
  tone: string;
  creditsUsed: number;
  warnings: { message: string }[];
  anchors?: Record<
    string,
    Record<string, { x: number; y: number; angle: number; widthPx: number }>
  >;
};
async function asDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("The image could not be opened."));
    r.readAsDataURL(blob);
  });
}
export default function AvatarViews({
  embedded = false,
  avatarId: fixedAvatar,
  initialKind = "portrait",
  onApproved,
}: {
  embedded?: boolean;
  avatarId?: string;
  initialKind?: Kind;
  onApproved?: (kind: Kind, image: string) => void;
} = {}) {
  const [available, setAvailable] = useState<boolean | null>(null),
    [portraitReady, setPortraitReady] = useState(false),
    [bodies, setBodies] = useState<string[]>(["male"]),
    [avatars, setAvatars] = useState<Avatar[]>([]),
    [avatar, setAvatar] = useState(""),
    [kind, setKind] = useState<Kind>(initialKind);
  const [saved, setSaved] = useState<Saved[]>([]),
    [savedImage, setSavedImage] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [face, setFace] = useState(""),
    [tone, setTone] = useState("medium");
  const [consent, setConsent] = useState(false),
    [avatarReviewed, setAvatarReviewed] = useState(false),
    [hair, setHair] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [storage, setStorage] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [handsReady, setHandsReady] = useState(false),
    [handsSource, setHandsSource] = useState("template"),
    [handPhoto, setHandPhoto] = useState(""),
    [handPoints, setHandPoints] = useState<HandPoints>({}),
    [handsConfirmed, setHandsConfirmed] = useState(false);
  const epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    alive = useRef(true),
    account = useRef("");
  function clear(privateData = false) {
    epoch.current++;
    controller.current?.abort();
    controller.current = null;
    setPreview(null);
    if (privateData) {
      setSavedImage("");
      setSaved([]);
    }
    setFace("");
    setHandPhoto("");
    setHandPoints({});
    setHandsConfirmed(false);
    setConsent(false);
    setAvatarReviewed(false);
    setHair(false);
    setReviewed(false);
    setStorage(false);
    setBusy(false);
    setNotice("");
  }
  async function refresh(id: string, selected: Kind, version: number) {
    const data = await catalogueApi("/api/avatars/" + encodeURIComponent(id) + "/views");
    let image = "";
    if (data.views.some((v: Saved) => v.kind === selected)) {
      const response = await requestApi(
        "/api/avatars/" + encodeURIComponent(id) + "/views/" + selected,
      );
      if (response.status === 401) window.dispatchEvent(new Event("forme-account-expired"));
      if (!response.ok) throw new Error("The saved view could not be opened.");
      image = await asDataUrl(await response.blob());
    }
    if (alive.current && epoch.current === version) {
      setSaved(data.views);
      setSavedImage(image);
    }
  }
  useEffect(() => {
    alive.current = true;
    let mounted = true;
    const expired = () => {
      clear(true);
      account.current = "";
      setAvatars([]);
      setAvatar("");
      setError("Your store session ended or changed. Sign in from Forme and reopen this page.");
    };
    const resume = () => {
      if (document.visibilityState !== "visible" || !account.current) return;
      void catalogueApi("/api/account")
        .then((data) => {
          if (
            mounted &&
            account.current &&
            data.account?.id + ":" + data.account?.user?.id !== account.current
          )
            expired();
        })
        .catch(() => {
          if (mounted) expired();
        });
    };
    window.addEventListener("forme-account-expired", expired);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    void (async () => {
      try {
        const health = await catalogueApi("/api/health");
        if (!mounted) return;
        setAvailable(health.avatarViewsAvailable === true);
        setPortraitReady(health.portraitGenerationAvailable === true);
        setHandsReady(
          health.customerHandsGenerationAvailable === true &&
            health.customerHandsContract === "customer-hands-v1",
        );
        setBodies(health.supportedBodies || ["male"]);
        if (!health.avatarViewsAvailable) return;
        const session = await catalogueApi("/api/account");
        if (!session.account) throw new Error("Sign in to your store account from Forme first.");
        const data = await catalogueApi("/api/avatars");
        if (!mounted) return;
        account.current = session.account.id + ":" + session.account.user.id;
        setAvatars(data.avatars);
        const requested = fixedAvatar || new URLSearchParams(location.search).get("avatar"),
          selected = data.avatars.find((a: Avatar) => a.id === requested) || data.avatars[0];
        if (selected) {
          setAvatar(selected.id);
          setTone(selected.templateTone || "medium");
        }
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
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, []);
  useEffect(() => {
    if (!avatar) return;
    const version = epoch.current;
    void refresh(avatar, kind, version).catch((e) => {
      if (alive.current && version === epoch.current) setError(e.message);
    });
  }, [avatar, kind]);
  function choose(id: string, nextKind = kind) {
    if (id === avatar && nextKind === kind) return;
    clear(true);
    setHandsSource("template");
    setError("");
    setAvatar(id);
    setKind(nextKind);
    setTone(avatars.find((a) => a.id === id)?.templateTone || "medium");
  }
  async function upload(file: File) {
    clear();
    setError("");
    const version = epoch.current;
    try {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        !file.size ||
        file.size > 5 * 1024 * 1024
      )
        throw new Error("Use a clear JPEG, PNG or WebP face photo under 5 MB.");
      const value = await asDataUrl(file);
      if (alive.current && version === epoch.current) setFace(value);
    } catch (e) {
      if (alive.current && version === epoch.current) setError((e as Error).message);
    }
  }
  async function create() {
    if (busy || !avatar) return;
    const version = ++epoch.current,
      abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setNotice("");
    setPreview(null);
    setReviewed(false);
    setStorage(false);
    try {
      const body =
        kind === "hands"
          ? handsSource === "template"
            ? { kind, source: "template", tone }
            : {
                kind,
                source: "photo",
                tone,
                handPhoto,
                handPoints,
                handsConfirmed,
                avatarReviewed,
                consent,
                consentScope: "hands-for-cleanup",
                consentProvider: "gemini",
                requestId: crypto.randomUUID(),
              }
          : {
              kind,
              facePhoto: face,
              avatarReviewed,
              consent,
              consentScope: "face-for-portrait",
              consentProvider: "gemini",
              hairBehindEars: hair,
              hairConsent: hair,
              requestId: crypto.randomUUID(),
            };
      const data = await catalogueApi(
        "/api/avatars/" + encodeURIComponent(avatar) + "/views",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abort.signal,
          body: JSON.stringify(body),
        },
        195000,
      );
      if (alive.current && version === epoch.current) {
        setPreview(data);
        setFace("");
        setHandPhoto("");
        setHandPoints({});
        setHandsConfirmed(false);
        setConsent(false);
        setAvatarReviewed(false);
        setNotice(
          kind === "hands"
            ? data.sourceKind === "photo"
              ? "Customer hands cleanup created. Review all fingers, wrists and placement markers before saving; one AI credit was used."
              : "Sample hands preview ready. No AI credits used."
            : "Portrait created. Review it before saving; one AI credit was used.",
        );
      }
    } catch (e) {
      if (alive.current && version === epoch.current) {
        setError(
          (e as Error).name === "AbortError"
            ? "The request stopped. No automatic retry was made; a provider charge may still apply."
            : (e as Error).message,
        );
        setConsent(false);
      }
    } finally {
      window.dispatchEvent(new Event("forme-credits-changed"));
      if (alive.current && version === epoch.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  async function approve() {
    if (!preview || busy) return;
    const version = epoch.current;
    setBusy(true);
    setError("");
    try {
      await catalogueApi(
        "/api/avatars/" + encodeURIComponent(avatar) + "/views/" + kind + "/approve",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: preview.image,
            receipt: preview.receipt,
            reviewed,
            storageConsent: storage,
          }),
        },
      );
      if (alive.current && version === epoch.current) {
        setPreview(null);
        setReviewed(false);
        setStorage(false);
        setNotice("Approved view saved to this avatar in your store account.");
        await refresh(avatar, kind, version);
        onApproved?.(kind, preview.image);
      }
    } catch (e) {
      if (alive.current && version === epoch.current) setError((e as Error).message);
    } finally {
      if (alive.current && version === epoch.current) setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm("Delete this saved " + kind + " view? Your full-body avatar stays saved."))
      return;
    clear();
    const version = epoch.current;
    setBusy(true);
    setError("");
    try {
      await catalogueApi("/api/avatars/" + encodeURIComponent(avatar) + "/views/" + kind, {
        method: "DELETE",
      });
      if (alive.current && version === epoch.current) {
        setNotice("Saved view deleted.");
        await refresh(avatar, kind, version);
      }
    } catch (e) {
      if (alive.current && version === epoch.current) setError((e as Error).message);
    } finally {
      if (alive.current && version === epoch.current) setBusy(false);
    }
  }
  const selected = avatars.find((a) => a.id === avatar),
    approved = saved.find((v) => v.kind === kind),
    canGenerate = portraitReady && bodies.includes(selected?.bodyType || "male");
  const Container = embedded ? "section" : "main";
  return (
    <Container className="billing-page avatar-views-page">
      {!embedded && (
        <nav>
          <a href="/">Back to Forme</a> · <a href="/catalogue">Store catalogue</a>
        </nav>
      )}
      {!embedded && <h1>Avatar views</h1>}
      <p>Keep an approved portrait and a hands reference with the customer’s saved avatar.</p>
      {available === null && <p role="status">Checking avatar views…</p>}
      {available === false && <p>Avatar views are not enabled on this studio.</p>}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {available && avatars.length === 0 && (
        <p>Sign in and save a full-body avatar from Forme to begin.</p>
      )}
      {available && selected && (
        <>
          {!embedded && (
            <section>
              <h2>Choose the saved avatar</h2>
              <label>
                Saved customer avatar
                <select
                  aria-label="Saved customer avatar"
                  disabled={busy}
                  value={avatar}
                  onChange={(e) => choose(e.target.value)}
                >
                  {avatars.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <img
                className="avatar-view-reference"
                src={selected.thumbnail}
                alt={"Saved full-body avatar: " + selected.name}
              />
              <p>
                {selected.name} · {selected.bodyType === "female" ? "Female" : "Male"} body library
              </p>
              <div className="customer-actions">
                <button
                  className="button secondary"
                  aria-pressed={kind === "portrait"}
                  disabled={busy}
                  onClick={() => choose(avatar, "portrait")}
                >
                  Portrait view
                </button>
                <button
                  className="button secondary"
                  aria-pressed={kind === "hands"}
                  disabled={busy}
                  onClick={() => choose(avatar, "hands")}
                >
                  Hands view
                </button>
              </div>
            </section>
          )}
          <section>
            <h2>{kind === "hands" ? "Prepare hands" : "Create a portrait"}</h2>
            {kind === "hands" ? (
              <>
                <label>
                  Hands reference source
                  <select
                    aria-label="Hands reference source"
                    value={handsSource}
                    disabled={busy}
                    onChange={(e) => {
                      clear();
                      setError("");
                      setHandsSource(e.target.value);
                    }}
                  >
                    <option value="template">Standard hands — free</option>
                    <option value="photo">Customer hand photo — 1 AI credit</option>
                  </select>
                </label>
                {handsSource === "template" ? (
                  <p>
                    These are reusable sample hands in a selected tone, rather than a photograph of
                    the customer’s own hands. They provide approximate jewellery placement only.
                  </p>
                ) : (
                  <>
                    <p>
                      One cleanup uses <strong>1 AI credit</strong>. The customer’s hand photo is
                      the complexion reference; the selected tone is a label and does not recolour
                      it. Review that it matches the saved avatar. Failed checks refund app credits;
                      the provider may still charge.
                    </p>
                    {(!handsReady || !bodies.includes(selected.bodyType)) && (
                      <p>
                        Customer hand generation is unavailable for this body library. Standard
                        hands remain free.
                      </p>
                    )}
                    <CustomerHandPhoto
                      photo={handPhoto}
                      points={handPoints}
                      disabled={busy}
                      onChange={(image, points) => {
                        clear();
                        setError("");
                        setHandPhoto(image);
                        setHandPoints(points);
                      }}
                    />
                    <label className="consent">
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={handsConfirmed}
                        onChange={(e) => setHandsConfirmed(e.target.checked)}
                      />
                      <span>
                        The customer confirms these are their own two hands, all fingers and wrists
                        are visible, and all twelve placement markers match.
                      </span>
                    </label>
                    <label className="consent">
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={avatarReviewed}
                        onChange={(e) => setAvatarReviewed(e.target.checked)}
                      />
                      <span>
                        The customer confirms the saved avatar and the hand photo’s complexion
                        match.
                      </span>
                    </label>
                    <label className="consent">
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      <span>
                        The customer agrees to send this hand photo to Google Gemini for one cleanup
                        using 1 AI credit. Original hand photos are not saved by the studio.
                      </span>
                    </label>
                  </>
                )}
                <label>
                  {handsSource === "photo" ? "Hands tone reference" : "Hands template skin tone"}
                  <select
                    aria-label={
                      handsSource === "photo" ? "Hands tone reference" : "Hands template skin tone"
                    }
                    disabled={busy}
                    value={tone}
                    onChange={(e) => {
                      setTone(e.target.value);
                      setConsent(false);
                      setPreview(null);
                      setReviewed(false);
                      setStorage(false);
                      setNotice("");
                    }}
                  >
                    {skinTones.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <p>
                  One portrait uses <strong>1 AI credit</strong>. Gemini receives this fresh face
                  photo and the selected saved avatar. Portraits require customer review; likeness
                  and skin tone may vary. Failed checks refund app credits; the provider may still
                  charge.
                </p>
                {!canGenerate && (
                  <p>
                    Portrait generation is unavailable for this body library. Ask the administrator
                    to check the Gemini service and enabled libraries.
                  </p>
                )}
                <p>
                  Face forward with the full head visible, ears visible where possible, neck and
                  collarbones in view, and a neutral neckline. Move hair behind the ears only if the
                  customer agrees.
                </p>
                <label>
                  Fresh customer face photo
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void upload(file);
                    }}
                  />
                </label>
                {face && (
                  <img
                    className="avatar-view-reference"
                    src={face}
                    alt="Fresh customer face reference"
                  />
                )}
                <label className="consent">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={avatarReviewed}
                    onChange={(e) => setAvatarReviewed(e.target.checked)}
                  />
                  <span>
                    The customer confirms this saved full-body avatar is correct and approved.
                  </span>
                </label>
                <label className="consent">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={hair}
                    onChange={(e) => setHair(e.target.checked)}
                  />
                  <span>The customer agrees to moving hair behind the ears for this portrait.</span>
                </label>
                <label className="consent">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>
                    The customer agrees to send this fresh face photo and saved avatar to Google
                    Gemini for one portrait, using 1 AI credit. Original face photos are not saved
                    by the studio.
                  </span>
                </label>
              </>
            )}
            <div className="customer-actions">
              <button
                className="button primary"
                disabled={
                  busy ||
                  (kind === "hands" &&
                    handsSource === "photo" &&
                    (!handsReady ||
                      !bodies.includes(selected.bodyType) ||
                      !handPhoto ||
                      !validHandPoints(handPoints) ||
                      !handsConfirmed ||
                      !avatarReviewed ||
                      !consent)) ||
                  (kind === "portrait" && (!canGenerate || !face || !consent || !avatarReviewed))
                }
                onClick={() => void create()}
              >
                {kind === "hands"
                  ? handsSource === "photo"
                    ? "Generate customer hands — 1 AI credit"
                    : "Preview sample hands — free"
                  : "Generate portrait — 1 AI credit"}
              </button>
              {busy && controller.current && (
                <button
                  className="button secondary"
                  onClick={() => {
                    clear();
                    setError(
                      "Request stopped. No automatic retry was sent; a provider charge may still apply.",
                    );
                  }}
                >
                  Cancel request
                </button>
              )}
            </div>
            {busy && (
              <p role="status">Working on this view… Keep this page open. No automatic retries.</p>
            )}
          </section>
          {preview && (
            <section aria-label="Review view preview">
              <h2>
                Review{" "}
                {preview.sourceKind === "template"
                  ? "sample hands"
                  : preview.sourceKind === "photo"
                    ? "customer hands"
                    : "generated portrait"}
              </h2>
              {preview.sourceKind === "photo" ? (
                <HandPhotoMarkers
                  image={preview.image}
                  points={Object.fromEntries(
                    ["left", "right"].flatMap((side) =>
                      Object.entries(preview.anchors?.[side] || {}).map(([finger, p]) => [
                        side + "." + finger,
                        p,
                      ]),
                    ),
                  )}
                  alt="Customer hands preview awaiting approval"
                />
              ) : (
                <img
                  className="avatar-view-image"
                  src={preview.image}
                  alt={
                    preview.sourceKind === "template"
                      ? "Sample hands preview awaiting approval"
                      : "Generated portrait awaiting customer approval"
                  }
                />
              )}
              <p>
                {preview.sourceKind === "photo"
                  ? "Check every finger, wrist, complexion and marker alignment. The automatic checks cannot verify anatomy or identity."
                  : ""}
              </p>
              {preview.warnings.map((w, i) => (
                <p key={i}>{w.message}</p>
              ))}
              <p>This preview has not been saved to the account.</p>
              <label className="consent">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                <span>
                  {kind === "hands"
                    ? preview.sourceKind === "photo"
                      ? "The customer reviewed their hands, every finger and wrist, complexion and all placement markers."
                      : "The customer reviewed the sample hands, tone and proportions."
                    : "The customer reviewed the face, complexion, hair, proportions and complete head framing."}
                </span>
              </label>
              <label className="consent">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={storage}
                  onChange={(e) => setStorage(e.target.checked)}
                />
                <span>
                  The customer agrees to save this approved view with this avatar in the store
                  account.
                </span>
              </label>
              <div className="customer-actions">
                <button
                  className="button primary"
                  disabled={busy || !reviewed || !storage}
                  onClick={() => void approve()}
                >
                  Approve and save view
                </button>
                {(!embedded || reviewed) && (
                  <a
                    className="button secondary"
                    href={preview.image}
                    download={kind + "-preview.png"}
                  >
                    Download preview
                  </a>
                )}
              </div>
              <p>
                Keep a downloaded copy if saving fails. Do not generate another image just to save
                this one.
              </p>
            </section>
          )}
          <section>
            <h2>Approved {kind} view</h2>
            {approved && savedImage ? (
              <>
                <img
                  className="avatar-view-image"
                  src={savedImage}
                  alt={"Approved " + kind + " view for " + selected.name}
                />
                <p>
                  {approved.sourceKind === "template"
                    ? "Sample hands reference"
                    : approved.sourceKind === "photo"
                      ? "Customer hands · photo cleanup"
                      : "Generated portrait"}{" "}
                  · Approved {new Date(approved.approvedAt).toLocaleString()}
                </p>
                <div className="customer-actions">
                  <a
                    className="button secondary"
                    href={savedImage}
                    download={kind + "-approved.png"}
                  >
                    Download approved view
                  </a>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    Delete saved view
                  </button>
                </div>
              </>
            ) : (
              <p>No approved {kind} view is saved for this avatar.</p>
            )}
          </section>
        </>
      )}
    </Container>
  );
}
