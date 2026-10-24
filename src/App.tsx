import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Expand,
  ImagePlus,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { profiles, recommendProfile } from "./profiles";
import { downloadAvatar, LIBRARY_URL, readPhoto } from "./images";
import { isNative, capturePhoto, clearNativeExports } from "./native";
import { requestApi } from "./api";
import StudioConnection from "./StudioConnection";
import { App as NativeApp } from "@capacitor/app";

type PhotoKind = "face" | "body";
type ServiceState = "checking" | "available" | "unavailable" | "unauthorized";

function AvatarImage({
  index,
  className = "",
}: {
  index: number;
  className?: string;
}) {
  return (
    <div
      className={`avatar-crop ${className}`}
      role="img"
      aria-label={`${profiles[index].name} standard male avatar`}
    >
      <img
        src={LIBRARY_URL}
        alt=""
        draggable={false}
        style={{ left: `${index * -100}%` }}
      />
    </div>
  );
}

function PhotoInput({
  kind,
  value,
  onChange,
  disabled,
}: {
  kind: PhotoKind;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const version = useRef(0);
  const title = kind === "face" ? "Face photo" : "Full-body photo";
  useEffect(
    () => () => {
      version.current++;
    },
    [],
  );
  async function choose(file?: File) {
    if (!file || disabled) return;
    const request = ++version.current;
    setError("");
    setReading(true);
    try {
      const photo = await readPhoto(file);
      if (request === version.current) onChange(photo);
    } catch (e) {
      if (request === version.current) setError((e as Error).message);
    } finally {
      if (request === version.current) setReading(false);
    }
  }
  async function openPhotoPicker() {
    if (!isNative) {
      input.current?.click();
      return;
    }
    const request = ++version.current;
    setReading(true);
    setError("");
    try {
      const file = await capturePhoto();
      if (file && request === version.current) {
        const photo = await readPhoto(file);
        if (request === version.current) onChange(photo);
      }
    } catch (e) {
      if (request === version.current) setError((e as Error).message);
    } finally {
      if (request === version.current) setReading(false);
    }
  }
  return (
    <div className="photo-field">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={`Upload ${title.toLowerCase()}`}
        disabled={disabled}
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className={`photo-upload ${value ? "has-photo" : ""}`}
        disabled={disabled || reading}
        aria-label={`${value ? "Replace" : "Add"} ${title.toLowerCase()}`}
        onClick={() => void openPhotoPicker()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void choose(e.dataTransfer.files[0]);
        }}
      >
        {value ? (
          <>
            <img src={value} alt={`Customer ${title.toLowerCase()}`} />
            <span className="photo-replace">
              <Camera size={14} /> Replace
            </span>
          </>
        ) : (
          <>
            <span className="photo-icon">
              {reading ? (
                <LoaderCircle className="spin" size={23} />
              ) : kind === "face" ? (
                <ScanFace size={25} />
              ) : (
                <UserRound size={25} />
              )}
            </span>
            <strong>{title}</strong>
            <span>
              {kind === "face"
                ? "Look straight ahead"
                : "Head to toe, standing"}
            </span>
            <span className="upload-caption">
              <Plus size={12} /> Add photo
            </span>
          </>
        )}
      </button>
      {value && (
        <button
          type="button"
          className="remove-photo"
          disabled={disabled}
          onClick={() => {
            version.current++;
            onChange(null);
          }}
          aria-label={`Remove ${title.toLowerCase()}`}
        >
          <X size={13} />
        </button>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default function App() {
  const [step, setStep] = useState(1);
  const [height, setHeight] = useState("175");
  const [weight, setWeight] = useState("72");
  const [selected, setSelected] = useState("regular");
  const [manual, setManual] = useState(false);
  const [face, setFace] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [service, setService] = useState<ServiceState>("checking");
  const [personalized, setPersonalized] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [help, setHelp] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [session, setSession] = useState(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [dialogFocus, setDialogFocus] = useState<HTMLElement | null>(null);
  const recommendation = recommendProfile(Number(height), Number(weight));
  const profile = profiles.find((p) => p.id === selected)!;
  const validMeasurements = recommendation !== null;
  const needsCustomerGeneration = Boolean(face || body) && !personalized;

  function checkService() {
    setService("checking");
    requestApi("/api/health")
      .then(async (r) => {
        if (r.status === 401) {
          setService("unauthorized");
          return;
        }
        if (!r.ok) throw new Error();
        const data = await r.json();
        setService(data.personalizationAvailable && data.personalizationContract === "customer-avatar-v2" ? "available" : "unavailable");
      })
      .catch(() => setService("unavailable"));
  }
  useEffect(() => {
    checkService();
    void clearNativeExports().catch(() =>
      setError(
        "Temporary exports could not be cleared. Please restart the app before using customer photos.",
      ),
    );
  }, []);
  useEffect(() => {
    if (!isNative) return;
    const listener = NativeApp.addListener("backButton", () => {
      const openDialog =
        document.querySelector<HTMLDialogElement>("dialog[open]");
      if (openDialog) {
        openDialog.dispatchEvent(new Event("cancel", { cancelable: true }));
        return;
      }
      if (generating || exporting) return;
      if (step > 1) goTo(step - 1);
      else if (face || body) setConfirmReset(true);
      else void NativeApp.minimizeApp();
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [step, face, body, generating, exporting]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if ((help || expanded || confirmReset) && dialog && !dialog.open) {
      setDialogFocus(document.activeElement as HTMLElement);
      dialog.showModal();
    } else if (dialog?.open && !help && !expanded && !confirmReset) {
      dialog.close();
      dialogFocus?.focus();
    }
  }, [help, expanded, confirmReset, dialogFocus]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(id);
  }, [notice]);

  function invalidate() {
    setPersonalized(null);
    setApproved(false);
    setAiConsent(false);
    setError("");
  }
  function updateMeasurement(field: "height" | "weight", value: string) {
    invalidate();
    if (field === "height") setHeight(value);
    else setWeight(value);
    const match = recommendProfile(
      Number(field === "height" ? value : height),
      Number(field === "weight" ? value : weight),
    );
    if (!manual && match) setSelected(match);
  }
  function changeProfile(id: string) {
    if (id === selected || generating || exporting) return;
    invalidate();
    setSelected(id);
    setManual(true);
  }
  function goTo(next: number) {
    if (next === 3 && needsCustomerGeneration) {
      setError("Generate the customer avatar before review. The preview is still a standard sample.");
      return;
    }
    if (!validMeasurements) {
      setError("Enter a height from 140–210 cm and weight from 35–200 kg.");
      return;
    }
    setError("");
    setStep(next);
    setTimeout(() => titleRef.current?.focus(), 0);
  }
  function reset() {
    void clearNativeExports().catch(() =>
      setError(
        "Session cleared, but a temporary export could not be removed. Clear the app cache before the next customer.",
      ),
    );
    setFace(null);
    setBody(null);
    setConsent(false);
    setAiConsent(false);
    setHeight("175");
    setWeight("72");
    setSelected("regular");
    setManual(false);
    setStep(1);
    invalidate();
    setConfirmReset(false);
    setSession((s) => s + 1);
    setNotice(
      "New session started. Previous customer photos have been cleared.",
    );
  }
  async function generate() {
    if (!face || !body || !aiConsent || !consent || generating) return;
    setGenerating(true);
    setError("");
    setApproved(false);
    try {
      const response = await requestApi(
        "/api/personalize",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ face, body, profileId: selected, measurements: { heightCm: Number(height), weightKg: Number(weight) }, consent: true, consentScope: "face-and-body" }),
        },
        100000,
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error ||
            "Personalization failed. Your standard avatar is still available.",
        );
      if (data.kind !== "customer-avatar" || data.profileId !== selected ||
          typeof data.image !== "string" || !data.image.startsWith("data:image/png;base64,"))
        throw new Error("The studio returned an unsupported result. Update the studio and try again.");
      setPersonalized(data.image);
      setAiConsent(false);
      setNotice(
        "Customer avatar created. Review the face, standard body and skin tone before approval.",
      );
    } catch (e) {
      setError(
        e instanceof Error &&
          (e.name === "TimeoutError" || e.name === "AbortError")
          ? "The request timed out. Please check before retrying; the provider may have processed it."
          : (e as Error).message,
      );
    } finally {
      setGenerating(false);
    }
  }
  async function download() {
    if (exporting || !approved || needsCustomerGeneration) return;
    setExporting(true);
    try {
      const exported = await downloadAvatar(
        profile.index,
        personalized,
        `${profile.id}${personalized ? "-personalized" : "-sample"}`,
      );
      setNotice(
        exported
          ? isNative
            ? "Share sheet closed. The avatar is ready to export again if needed."
            : "Avatar downloaded as a PNG."
          : "Export cancelled. Your avatar is still available.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  const preview = personalized ? (
    <img
      className="personalized-image"
      src={personalized}
      alt="Customer’s personalized avatar, awaiting visual review"
    />
  ) : (
    <AvatarImage index={profile.index} />
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Forme home">
          <span className="brand-symbol">
            <Leaf size={22} />
          </span>
          forme<span className="brand-dot">.</span>
        </a>
        <span className="brand-divider" />
        <span className="workspace-name">STORE STUDIO</span>
        <div className="topbar-right">
          <StudioConnection
            disabled={generating || exporting}
            onChange={checkService}
          />
          <span className="pilot-pill">
            <span /> Level 1 · Pilot
          </span>
          <button
            className="icon-button help-button"
            aria-label="How it works"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={20} />
          </button>
          <span className="store-avatar">ST</span>
        </div>
      </header>
      <main>
        <section className="page-heading">
          <div>
            <div className="eyebrow">A MORE PERSONAL TRY-ON</div>
            <h1>Every great fit starts with you.</h1>
            <p>
              Create a customer avatar. Make every visit a little more personal.
            </p>
          </div>
          <button
            className="button secondary new-session"
            disabled={generating || exporting}
            onClick={() => setConfirmReset(true)}
          >
            <Plus size={16} /> New session
          </button>
        </section>
        <nav className="steps" aria-label="Avatar creation steps">
          {["Customer details", "Match & personalize", "Review & save"].map(
            (label, i) => (
              <button
                key={label}
                className={`step ${step === i + 1 ? "current" : ""} ${step > i + 1 ? "complete" : ""}`}
                disabled={generating || i + 1 > step}
                aria-current={step === i + 1 ? "step" : undefined}
                onClick={() => goTo(i + 1)}
              >
                <span className="step-number">
                  {step > i + 1 ? <Check size={14} /> : `0${i + 1}`}
                </span>
                <span>{label}</span>
                {i < 2 && <span className="step-line" />}
              </button>
            ),
          )}
        </nav>
        <div className="studio-grid">
          <aside className="details-column">
            <section className="card customer-card">
              <div className="card-heading">
                <span className="section-icon">
                  <UserRound size={17} />
                </span>
                <h2 ref={titleRef} tabIndex={-1}>
                  {step === 1
                    ? "Customer details"
                    : step === 2
                      ? "Personalize the avatar"
                      : "Ready for review"}
                </h2>
                <span className="tiny-label">{`0${step}`}</span>
              </div>
              {step === 1 ? (
                <>
                  <p className="section-copy">
                    A few details to find their closest starting point.
                  </p>
                  <div className="field-label-row">
                    <h3>Customer photos</h3>
                    <span>Optional for a sample</span>
                  </div>
                  <label className="consent photo-consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      disabled={generating || exporting}
                      onChange={(e) => {
                        setConsent(e.target.checked);
                        if (!e.target.checked) {
                          setFace(null);
                          setBody(null);
                          setAiConsent(false);
                          setSession((s) => s + 1);
                          invalidate();
                        }
                      }}
                    />
                    <span>
                      The customer agrees to use their photos for this avatar
                      session.
                    </span>
                  </label>
                  <div className="photo-grid" key={session}>
                    <PhotoInput
                      kind="face"
                      value={face}
                      disabled={!consent || generating}
                      onChange={(value) => {
                        invalidate();
                        setFace(value);
                      }}
                    />
                    <PhotoInput
                      kind="body"
                      value={body}
                      disabled={!consent || generating}
                      onChange={(value) => {
                        invalidate();
                        setBody(value);
                      }}
                    />
                  </div>
                  <p className="photo-hint">
                    <Camera size={13} /> Clear light. Natural pose. No filters.
                  </p>
                  <div className="section-separator" />
                  <div className="field-label-row">
                    <h3>Body measurements</h3>
                    <span>Approximate is okay</span>
                  </div>
                  <div className="measurement-grid">
                    <label>
                      Height
                      <div className="unit-input">
                        <input
                          aria-label="Height in centimeters"
                          type="number"
                          min="140"
                          max="210"
                          value={height}
                          onChange={(e) =>
                            updateMeasurement("height", e.target.value)
                          }
                        />
                        <span>cm</span>
                      </div>
                    </label>
                    <label>
                      Weight
                      <div className="unit-input">
                        <input
                          aria-label="Weight in kilograms"
                          type="number"
                          min="35"
                          max="200"
                          value={weight}
                          onChange={(e) =>
                            updateMeasurement("weight", e.target.value)
                          }
                        />
                        <span>kg</span>
                      </div>
                    </label>
                  </div>
                  {!validMeasurements && (
                    <p className="field-error">
                      Use 140–210 cm and 35–200 kg for this adult sample
                      library.
                    </p>
                  )}
                  <div className="library-label">
                    <span>Avatar library</span>
                    <span>
                      Adult male · 4 profiles <ChevronDown size={13} />
                    </span>
                  </div>
                  <div className="inline-note">
                    <Leaf size={16} />
                    <p>
                      We match an approximate frame. Staff can adjust the
                      profile using the full-body photo.
                    </p>
                  </div>
                </>
              ) : step === 2 ? (
                <>
                  <p className="section-copy">
                    Generate the customer’s face and matching skin tone on the
                    selected standard body using both customer photos.
                  </p>
                  <div className="summary-row">
                    <span>Selected profile</span>
                    <strong>{profile.name}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Customer measurements</span>
                    <strong>
                      {height} cm · {weight} kg
                    </strong>
                  </div>
                  <div className="mini-photos">
                    {face ? (
                      <img src={face} alt="Customer face reference" />
                    ) : (
                      <span>
                        <ScanFace />
                      </span>
                    )}
                    {body ? (
                      <img
                        src={body}
                        alt="Customer full-body reference for avatar generation"
                      />
                    ) : (
                      <span>
                        <UserRound />
                      </span>
                    )}
                    <div>
                      <strong>
                        {face && body ? "Photos ready" : "Photos not added"}
                      </strong>
                      <p>
                        {face && body
                          ? "Both photos are sent only when you generate."
                          : "Both photos are needed to personalize."}
                      </p>
                    </div>
                  </div>
                  <div
                    className={`service-note ${service === "available" ? "available" : ""}`}
                  >
                    <span className="status-dot" />
                    <div>
                      <strong>
                        {service === "checking"
                          ? "Checking avatar generation…"
                          : service === "available"
                            ? "Customer avatar generation available"
                            : service === "unauthorized"
                              ? "Studio connection required"
                              : "Customer avatar generation unavailable"}
                      </strong>
                      <p>
                        {service === "available"
                          ? "One generation, then reuse the approved avatar."
                          : service === "unauthorized"
                            ? "Open Studio connection (the cloud icon at the top) and enter your store access code. Then confirm generation consent. Your photos have not been sent."
                            : "Connect an updated studio with AI generation enabled. This preview has not used your photos."}
                      </p>
                    </div>
                  </div>
                  {service === "available" && (
                    <label className="consent">
                      <input
                        type="checkbox"
                        checked={aiConsent}
                        disabled={generating || exporting}
                        onChange={(e) => setAiConsent(e.target.checked)}
                      />
                      <span>
                        The customer agrees to send their face photo, full-body
                        photo and approximate height/weight to Google’s Gemini
                        service to generate their avatar and match skin tone.
                        Provider retention terms apply.
                      </span>
                    </label>
                  )}
                  <button
                    className="button primary full-width"
                    disabled={
                      service !== "available" ||
                      !face ||
                      !body ||
                      !aiConsent ||
                      generating
                    }
                    onClick={() => void generate()}
                  >
                    {generating ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Sparkles size={16} />
                    )}
                    {generating
                      ? "Creating avatar…"
                      : personalized
                        ? "Create again"
                        : "Generate customer avatar"}
                  </button>
                  {personalized && (
                    <button
                      className="text-button"
                      disabled={generating || exporting}
                      onClick={() => {
                        invalidate();
                        setNotice("Returned to the standard sample avatar.");
                      }}
                    >
                      Discard generated avatar
                    </button>
                  )}
                  <p className="small-footnote">
                    Check the suggested body with the customer. Height and
                    weight alone cannot determine body proportions.
                  </p>
                </>
              ) : (
                <>
                  <p className="section-copy">
                    Check the result together before keeping it.
                  </p>
                  {needsCustomerGeneration && (
                    <p className="error-banner" role="alert">
                      The photos or body profile changed. Go back and generate a new customer avatar before approving or exporting.
                    </p>
                  )}
                  <div className="review-type">
                    <span className="section-icon">
                      {personalized ? (
                        <ScanFace size={22} />
                      ) : (
                        <UserRound size={22} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {personalized
                          ? "Personalized avatar"
                          : "Standard sample avatar"}
                      </strong>
                      <p>
                        {personalized
                          ? "Customer face and skin tone on the selected standard body"
                          : "Sample face · no customer face applied"}
                      </p>
                    </div>
                  </div>
                  {personalized && (
                    <div className="mini-photos">
                      <img src={face!} alt="Original customer face for skin-tone review" />
                      <img src={body!} alt="Original customer body for skin-tone review" />
                      <p>Compare the face and skin tone with the original photos. Check the neck, arms, hands, legs and feet.</p>
                    </div>
                  )}
                  <div className="summary-row">
                    <span>Body profile</span>
                    <strong>{profile.name}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Height / weight</span>
                    <strong>
                      {height} cm / {weight} kg
                    </strong>
                  </div>
                  <ul className="review-list">
                    <li>
                      <Check size={15} /> Check the customer’s face and hair
                    </li>
                    <li>
                      <Check size={15} /> Confirm the approximate body profile
                    </li>
                    <li>
                      <Check size={15} /> Confirm consistent skin tone across face and body
                    </li>
                  </ul>
                  <label className="consent approval-consent">
                    <input
                      type="checkbox"
                      checked={approved}
                      disabled={needsCustomerGeneration || exporting}
                      onChange={(e) => setApproved(e.target.checked)}
                    />
                    <span>
                      {personalized
                        ? "The customer approves the face, body and skin tone of this avatar."
                        : "I have reviewed this standard sample avatar."}
                    </span>
                  </label>
                  <button
                    className="button primary full-width"
                    disabled={!approved || exporting || needsCustomerGeneration}
                    onClick={() => void download()}
                  >
                    <ArrowDownToLine size={16} />{" "}
                    {exporting
                      ? "Preparing PNG…"
                      : isNative
                        ? "Save or share avatar"
                        : "Download avatar"}
                  </button>
                  <p className="small-footnote">
                    {isNative
                      ? "Save a PNG using the share sheet. Session photos stay in memory; temporary exports are cleared on the next session, export, or app launch."
                      : "Downloads a PNG. Photos and results are held only in this browser session; download before leaving."}
                  </p>
                </>
              )}
              {error && (
                <div role="alert" className="error-banner">
                  {error}
                </div>
              )}
              <div className="form-navigation">
                {step > 1 && (
                  <button
                    className="button back-button"
                    disabled={generating || exporting}
                    onClick={() => goTo(step - 1)}
                  >
                    <ArrowLeft size={15} /> Back
                  </button>
                )}
                {step < 3 && (
                  <button
                    className="button primary continue-button"
                    disabled={!validMeasurements || generating || exporting || (step === 2 && needsCustomerGeneration)}
                    onClick={() => goTo(step + 1)}
                  >
                    {step === 1 ? "Continue to match" : "Review avatar"}
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
            </section>
            <div className="privacy-note">
              <ShieldCheck size={20} />
              <div>
                <strong>A little care goes a long way.</strong>
                <p>
                  Photos stay in this session until you explicitly generate.
                  Generation sends both photos and approximate measurements to the AI service.
                </p>
              </div>
            </div>
          </aside>
          <section className="preview-card" aria-label="Avatar preview">
            <div className="preview-top">
              <span>
                <span className="live-dot" />{" "}
                {personalized ? "PERSONALIZED PREVIEW" : "AVATAR PREVIEW"}
              </span>
              <button
                className="icon-button"
                aria-label="Expand avatar preview"
                onClick={() => setExpanded(true)}
              >
                <Expand size={16} />
              </button>
            </div>
            <div className="avatar-stage">
              {preview}
              <span className="sample-badge">
                {personalized ? "Review required" : "Sample avatar"}
              </span>
              <div className="avatar-meta">
                <span>{profile.name} profile</span>
                <strong>
                  {personalized
                    ? "A familiar face. A fresh start."
                    : "Your starting point."}
                </strong>
                <span>
                  {personalized
                    ? "Created for this session"
                    : "Fixed pose · reusable body profile"}
                </span>
              </div>
              {generating && (
                <div className="generating-overlay">
                  <LoaderCircle className="spin" size={28} />
                  <strong>Creating your avatar</strong>
                  <span>This can take a moment.</span>
                </div>
              )}
            </div>
            <div className="preview-bottom">
              <div>
                <span className="status-dot" />
                <span>
                  {approved
                    ? "Reviewed and approved"
                    : personalized
                      ? "Ready for customer review"
                      : "Standard avatar · face not personalized"}
                </span>
              </div>
              <span className="preview-ratio">FULL BODY</span>
            </div>
          </section>
          <aside className="profiles-column">
            <section className="card profile-card">
              <div className="card-heading">
                <span className="section-icon">
                  <ScanFace size={18} />
                </span>
                <h2>Find their frame</h2>
              </div>
              <p className="section-copy">
                Start with a close match.
                <br /> Adjust it together.
              </p>
              <div className="profile-grid">
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    className={`profile-option ${selected === p.id ? "selected" : ""}`}
                    disabled={generating || exporting}
                    aria-label={`Select ${p.name} profile`}
                    aria-pressed={selected === p.id}
                    onClick={() => changeProfile(p.id)}
                  >
                    <div className="profile-thumbnail">
                      <AvatarImage index={p.index} />
                      {selected === p.id && (
                        <span className="selection-check">
                          <Check size={12} />
                        </span>
                      )}
                    </div>
                    <div className="profile-option-label">
                      <strong>{p.name}</strong>
                      {p.id === recommendation && (
                        <span
                          className="recommended-mark"
                          title="Suggested from height and weight"
                        >
                          ✦
                        </span>
                      )}
                    </div>
                    <span className="profile-description">{p.description}</span>
                  </button>
                ))}
              </div>
              <div className="recommendation">
                <Sparkles size={16} />
                <p>
                  {recommendation ? (
                    <>
                      <strong>
                        {profiles.find((p) => p.id === recommendation)?.name}
                      </strong>{" "}
                      is a starting suggestion from height and weight.
                    </>
                  ) : (
                    "Enter valid measurements to see a suggestion."
                  )}
                </p>
              </div>
              {manual && recommendation && selected !== recommendation && (
                <button
                  className="text-button"
                  disabled={generating || exporting}
                  onClick={() => {
                    invalidate();
                    setSelected(recommendation);
                    setManual(false);
                  }}
                >
                  <RotateCcw size={12} /> Use suggested profile
                </button>
              )}
              <p className="profile-footnote">
                Illustrative profiles, not calibrated sizing. Athletic build is
                selected by staff.
              </p>
            </section>
            <section className="next-card">
              <span className="next-label">MADE FOR WHAT’S NEXT</span>
              <div className="next-card-icon">
                <ImagePlus size={22} />
              </div>
              <h3>
                One avatar.
                <br /> More possibilities.
              </h3>
              <p>
                An approved avatar becomes the starting point for future outfit
                previews.
              </p>
              <span className="coming-soon">
                Clothing try-on · Next phase <ArrowRight size={13} />
              </span>
            </section>
          </aside>
        </div>
        <footer>
          <span>
            <LockKeyhole size={13} /> Customer-first, by design
          </span>
          <p>
            An approximate visual preview. Not a measurement or fit guarantee.
          </p>
          <span>
            FORME STUDIO <span className="footer-dot">·</span> LEVEL 1
          </span>
        </footer>
      </main>
      <div className="toast-region" role="status" aria-live="polite">
        {notice && (
          <div className="toast">
            <CheckCheck size={17} />
            {notice}
          </div>
        )}
      </div>
      <dialog
        ref={dialogRef}
        className={expanded ? "expanded-dialog" : ""}
        onCancel={() => {
          setHelp(false);
          setExpanded(false);
          setConfirmReset(false);
        }}
        aria-label={
          help
            ? "How Avatar Studio works"
            : confirmReset
              ? "Start a new session"
              : "Expanded avatar preview"
        }
      >
        <button
          className="dialog-close icon-button"
          aria-label="Close dialog"
          onClick={() => {
            setHelp(false);
            setExpanded(false);
            setConfirmReset(false);
          }}
        >
          <X size={20} />
        </button>
        {help ? (
          <div className="help-content">
            <span className="eyebrow">WELCOME TO FORME</span>
            <h2>
              A familiar face.
              <br /> A simple starting point.
            </h2>
            <ol>
              <li>
                <strong>Add customer details.</strong>
                <p>
                  Use consented photos and enter height and weight. You can
                  explore the sample library without photos.
                </p>
              </li>
              <li>
                <strong>Choose a close body profile.</strong>
                <p>
                  The suggestion uses a basic height/weight rule. Staff review
                  the full-body photo and adjust the profile. Automated
                  photo-based measurements are not included.
                </p>
              </li>
              <li>
                <strong>Personalize, review, and download.</strong>
                <p>
                  With consent, generate the customer’s face and matching skin
                  tone on the chosen standard body. Review all exposed skin and
                  approve before export. Sample downloads are available only in
                  sessions without customer photos.
                </p>
              </li>
            </ol>
            <p className="small-footnote">
              This pilot holds photos in memory. Starting a new session or
              reloading clears them. Clothing swaps and saved customer accounts
              are planned for a later phase.
            </p>
          </div>
        ) : confirmReset ? (
          <div className="help-content">
            <h2>Start fresh?</h2>
            <p>
              The current photos and generated result will be cleared from this
              browser session. Download an approved avatar first if you want to
              keep it.
            </p>
            <div className="dialog-actions">
              <button
                className="button secondary"
                onClick={() => setConfirmReset(false)}
              >
                Keep working
              </button>
              <button className="button primary" onClick={reset}>
                Start new session
              </button>
            </div>
          </div>
        ) : expanded ? (
          <div className="expanded-preview">
            {preview}
            <p>
              {profile.name} ·{" "}
              {personalized ? "Personalized avatar" : "Standard sample avatar"}
            </p>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
