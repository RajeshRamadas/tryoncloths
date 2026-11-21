import { useEffect, useState } from "react";
import { requestApi } from "./api";
import { catalogueApi } from "./catalogue";
export type StoreBranding = {
  displayName: string;
  primaryColor: string;
  phone: string;
  address: string;
  mapUrl: string;
  exportFooter: boolean;
  portraitWithAvatar: boolean;
  revision: string;
  hasLogo: boolean;
  trial: boolean;
};
export function BrandLogo({ revision, name }: { revision: string; name: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let live = true,
      created = "";
    void requestApi("/api/branding/logo?revision=" + encodeURIComponent(revision))
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const blob = await response.blob();
        if (live) {
          created = URL.createObjectURL(blob);
          setUrl(created);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [revision]);
  return url ? <img className="brand-logo-preview" src={url} alt={name + " logo"} /> : null;
}
export function ExportBrandingChoice({
  onChange,
}: {
  onChange: (value: boolean | undefined) => void;
}) {
  const [settings, setSettings] = useState<StoreBranding | null>(null),
    [choice, setChoice] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    onChange(undefined);
    void catalogueApi("/api/branding")
      .then((data) => {
        if (live) {
          setSettings(data);
          setChoice(data.exportFooter);
          onChange(data.exportFooter);
        }
      })
      .catch(() => {
        if (live) setError("Export settings could not load. Server branding defaults still apply.");
      });
    return () => {
      live = false;
    };
  }, [onChange]);
  return (
    <div className="export-branding-choice">
      {settings?.trial ? (
        <p>The Forme trial mark is required on exports.</p>
      ) : (
        settings && (
          <label className="consent">
            <input
              type="checkbox"
              checked={choice}
              onChange={(e) => {
                setChoice(e.target.checked);
                onChange(e.target.checked);
              }}
            />
            <span>Include store footer on this export</span>
          </label>
        )
      )}
      {error && <p>{error}</p>}
    </div>
  );
}
export default function Branding() {
  const [saved, setSaved] = useState<StoreBranding | null>(null),
    [values, setValues] = useState({
      displayName: "",
      primaryColor: "#215b4a",
      phone: "",
      address: "",
      mapUrl: "",
      exportFooter: false,
      portraitWithAvatar: false,
    }),
    [logo, setLogo] = useState<File | null>(null),
    [remove, setRemove] = useState(false),
    [busy, setBusy] = useState(false),
    [owner, setOwner] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    void Promise.all([catalogueApi("/api/account"), catalogueApi("/api/branding")])
      .then(([account, data]) => {
        if (live) {
          setOwner(account.account?.user?.role === "owner");
          setSaved(data);
          setValues(data);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (
        logo &&
        (!["image/png", "image/jpeg", "image/svg+xml"].includes(logo.type) ||
          logo.size > 500 * 1024)
      )
        throw new Error("Choose a PNG, JPEG or static SVG logo up to 500 KB.");
      const image = logo
        ? await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("The logo could not be read."));
            reader.readAsDataURL(logo);
          })
        : undefined;
      const data = await catalogueApi("/api/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: values.displayName,
          primaryColor: values.primaryColor,
          phone: values.phone,
          address: values.address,
          mapUrl: values.mapUrl,
          exportFooter: values.exportFooter,
          portraitWithAvatar: values.portraitWithAvatar,
          revision: saved?.revision,
          ...(image ? { logo: image } : remove ? { logo: null } : {}),
        }),
      });
      setSaved(data);
      setValues(data);
      setLogo(null);
      setRemove(false);
      setNotice("Store branding saved. Shared pages and new exports use these settings.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const update = (key: keyof typeof values, value: string | boolean) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  const ink = (colour: string) => {
    if (!/^#[a-f0-9]{6}$/i.test(colour)) return "#ffffff";
    const c = colour
      .slice(1)
      .match(/../g)!
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.179 ? "#000000" : "#ffffff";
  };
  return (
    <main className="billing-page branding-page">
      <h1>Store branding</h1>
      <p>
        Set the identity shown on shared outfits, WhatsApp lookbooks and exported images. Branding
        uses no AI credits.
      </p>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {saved && (
        <>
          <section>
            <h2>Saved branding preview</h2>
            <div
              className="brand-card"
              style={{ backgroundColor: saved.primaryColor, color: ink(saved.primaryColor) }}
            >
              {saved.hasLogo && <BrandLogo revision={saved.revision} name={saved.displayName} />}
              <h3>{saved.displayName}</h3>
              <p>{saved.phone}</p>
              <p>{saved.address}</p>
            </div>
            {saved.mapUrl && (
              <a href={saved.mapUrl} target="_blank" rel="noreferrer">
                Open saved map link
              </a>
            )}
            <p>
              {saved.trial
                ? "The Forme trial mark is mandatory on exported and shared images."
                : "Store footers are optional on exports. The default preference below applies to shared images and approved catalogue-photo downloads."}
            </p>
          </section>
          {owner ? (
            <section>
              <h2>Edit active store branding</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <label>
                  Public store name
                  <input
                    required
                    maxLength={80}
                    value={values.displayName}
                    disabled={busy}
                    onChange={(e) => update("displayName", e.target.value)}
                  />
                </label>
                <label>
                  Primary colour
                  <input
                    required
                    pattern="#[a-fA-F0-9]{6}"
                    maxLength={7}
                    value={values.primaryColor}
                    disabled={busy}
                    onChange={(e) => update("primaryColor", e.target.value)}
                  />
                </label>
                <label>
                  Store phone
                  <input
                    type="tel"
                    maxLength={40}
                    value={values.phone}
                    disabled={busy}
                    onChange={(e) => update("phone", e.target.value)}
                  />
                </label>
                <label>
                  Store address
                  <input
                    maxLength={300}
                    value={values.address}
                    disabled={busy}
                    onChange={(e) => update("address", e.target.value)}
                  />
                </label>
                <label>
                  Store map link
                  <input
                    type="url"
                    placeholder="https://maps.google.com/..."
                    maxLength={2048}
                    value={values.mapUrl}
                    disabled={busy}
                    onChange={(e) => update("mapUrl", e.target.value)}
                  />
                </label>
                <label>
                  Store logo
                  <input
                    key={saved.revision}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,.svg"
                    disabled={busy}
                    onChange={(e) => {
                      setLogo(e.target.files?.[0] || null);
                      setRemove(false);
                    }}
                  />
                </label>
                <p>
                  PNG, JPEG or static SVG, up to 500 KB. Uploaded SVG is validated and converted to
                  PNG. New logos appear after saving.
                </p>
                {saved.hasLogo && (
                  <label className="consent">
                    <input
                      type="checkbox"
                      checked={remove}
                      disabled={busy || Boolean(logo)}
                      onChange={(e) => setRemove(e.target.checked)}
                    />
                    <span>Remove the saved logo</span>
                  </label>
                )}
                <label className="consent">
                  <input
                    type="checkbox"
                    checked={values.exportFooter}
                    disabled={busy}
                    onChange={(e) => update("exportFooter", e.target.checked)}
                  />
                  <span>
                    Include the store footer by default on eligible exports and shared images
                  </span>
                </label>
                <label className="consent">
                  <input
                    type="checkbox"
                    checked={values.portraitWithAvatar}
                    disabled={busy}
                    onChange={(e) => update("portraitWithAvatar", e.target.checked)}
                  />
                  <span>
                    Jewellery: open portrait creation after every saved avatar, reusing the
                    customer’s face photo (1 more AI credit per customer, with their consent)
                  </span>
                </label>
                {saved.trial && (
                  <p>
                    The store-footer preference takes effect after the trial. It cannot disable the
                    Forme mark.
                  </p>
                )}
                <button className="button primary" disabled={busy}>
                  {busy ? "Saving branding…" : "Save store branding"}
                </button>
              </form>
            </section>
          ) : (
            <p>
              Only the owner can change branding. Staff and managers use the saved store settings.
            </p>
          )}
        </>
      )}
    </main>
  );
}
