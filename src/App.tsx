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

type PhotoKind = "face" | "body";
type ServiceState = "checking" | "available" | "unavailable";

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
  return (
    <div className="photo-field">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="user"
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
        onClick={() => input.current?.click()}
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

  useEffect(() => {
    fetch("/api/health")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) =>
        setService(data.personalizationAvailable ? "available" : "unavailable"),
      )
      .catch(() => setService("unavailable"));
  }, []);
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
    if (id === selected) return;
    invalidate();
    setSelected(id);
    setManual(true);
  }
  function goTo(next: number) {
    if (!validMeasurements) {
      setError("Enter a height from 140–210 cm and weight from 35–200 kg.");
      return;
    }
    setError("");
    setStep(next);
    setTimeout(() => titleRef.current?.focus(), 0);
  }
  function reset() {
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
      const response = await fetch("/api/personalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ face, profileId: selected, consent: true }),
        signal: AbortSignal.timeout(100000),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error ||
            "Personalization failed. Your standard avatar is still available.",
        );
      setPersonalized(data.image);
      setAiConsent(false);
      setNotice(
        "Personalized avatar created. Review the face and body before approval.",
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
    try {
      await downloadAvatar(
        profile.index,
        personalized,
        `${profile.id}${personalized ? "-personalized" : "-sample"}`,
      );
      setNotice("Avatar downloaded as a PNG.");
    } catch (e) {
      setError((e as Error).message);
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
            disabled={generating}
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
                      disabled={generating}
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
                    Keep the selected body and add the customer’s face in one
                    separate step.
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
                        alt="Customer full-body reference for staff review"
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
                          ? "Full-body photo stays on this device."
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
                          ? "Checking personalization…"
                          : service === "available"
                            ? "Face personalization available"
                            : "Face personalization unavailable"}
                      </strong>
                      <p>
                        {service === "available"
                          ? "One generation, then reuse the approved avatar."
                          : "You can continue with the standard sample avatar."}
                      </p>
                    </div>
                  </div>
                  {service === "available" && (
                    <label className="consent">
                      <input
                        type="checkbox"
                        checked={aiConsent}
                        disabled={generating}
                        onChange={(e) => setAiConsent(e.target.checked)}
                      />
                      <span>
                        The customer agrees to send their face photo to Google’s
                        Gemini service for this generation. Provider retention
                        terms apply. The full-body photo stays here.
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
                        : "Personalize face"}
                  </button>
                  {personalized && (
                    <button
                      className="text-button"
                      disabled={generating}
                      onClick={() => {
                        invalidate();
                        setNotice("Returned to the standard sample avatar.");
                      }}
                    >
                      Use standard avatar instead
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
                          ? "Face generated for this session"
                          : "Sample face · no customer face applied"}
                      </p>
                    </div>
                  </div>
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
                      <Check size={15} /> Check the face and overall appearance
                    </li>
                    <li>
                      <Check size={15} /> Confirm the approximate body profile
                    </li>
                    <li>
                      <Check size={15} /> Keep a copy for future outfit previews
                    </li>
                  </ul>
                  <label className="consent approval-consent">
                    <input
                      type="checkbox"
                      checked={approved}
                      onChange={(e) => setApproved(e.target.checked)}
                    />
                    <span>
                      {personalized
                        ? "The customer approves this avatar."
                        : "I have reviewed this standard sample avatar."}
                    </span>
                  </label>
                  <button
                    className="button primary full-width"
                    disabled={!approved}
                    onClick={() => void download()}
                  >
                    <ArrowDownToLine size={16} /> Download avatar
                  </button>
                  <p className="small-footnote">
                    Downloads a PNG. Photos and results are held only in this
                    browser session; download before leaving.
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
                    disabled={generating}
                    onClick={() => goTo(step - 1)}
                  >
                    <ArrowLeft size={15} /> Back
                  </button>
                )}
                {step < 3 && (
                  <button
                    className="button primary continue-button"
                    disabled={!validMeasurements || generating}
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
                  Photos stay in this session. Only an explicitly requested face
                  generation sends a photo to the AI service.
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
                <br />{" "}
                Adjust it together.
              </p>
              <div className="profile-grid">
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    className={`profile-option ${selected === p.id ? "selected" : ""}`}
                    disabled={generating}
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
                  disabled={generating}
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
                <br />{" "}
                More possibilities.
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
            FORME STUDIO <span className="footer-dot">·</span> V0.1
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
              <br />{" "}A simple starting point.
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
                  When the service is available, send the face photo for a
                  separately consented AI step. Otherwise, download a clearly
                  labelled standard sample.
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
