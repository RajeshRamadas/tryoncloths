import { useEffect, useRef, useState } from "react";
import { jewelleryApi, blobData } from "./jewellery-api";
import { overlayAnchors } from "./jewellery-overlay";
import type { JewelleryType } from "./jewellery-types";
export default function JewelleryOverlayUpload({
  id,
  type,
  hasOverlay,
  onSaved,
}: {
  id: string;
  type: JewelleryType;
  hasOverlay: boolean;
  onSaved: () => void;
}) {
  const [image, setImage] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const version = useRef(0),
    abort = useRef<AbortController | null>(null);
  useEffect(() => {
    const clear = () => {
      version.current++;
      abort.current?.abort();
      setImage("");
      setConsent(false);
    };
    window.addEventListener("forme-account-expired", clear);
    return () => {
      clear();
      window.removeEventListener("forme-account-expired", clear);
    };
  }, []);
  async function read(file: File) {
    const v = ++version.current;
    setError("");
    try {
      if (file.type !== "image/png" || file.size > 2 * 1024 * 1024 || !file.size)
        throw new Error("Choose a transparent PNG under 2 MB.");
      const data = await blobData(file);
      if (v === version.current) {
        setImage(data);
        setConsent(false);
      }
    } catch (e) {
      if (v === version.current) setError((e as Error).message);
    }
  }
  async function save(remove = false) {
    const v = ++version.current,
      controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    try {
      await jewelleryApi(
        "/api/garments/" + encodeURIComponent(id) + "/overlay?category=jewellery",
        {
          overlayPng: remove ? null : image,
          overlayAnchor: overlayAnchors[type],
          storageConsent: true,
        },
        controller.signal,
      );
      if (v === version.current) {
        setImage("");
        setConsent(false);
        onSaved();
      }
    } catch (e) {
      if (v === version.current) setError((e as Error).message);
    } finally {
      if (v === version.current) setBusy(false);
    }
  }
  return (
    <details className="jewellery-cutout">
      <summary>Transparent cut-out{hasOverlay ? " · ready" : ""}</summary>
      <p>
        Add a single piece on a transparent background: PNG, at least 200 × 200 px, at most 2048 px
        per side and 2 MB. A paired earring is mirrored in the editor.
      </p>
      <label>
        Cut-out PNG
        <input
          type="file"
          accept="image/png"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void read(f);
          }}
        />
      </label>
      {image && (
        <img
          className="inventory-photo cutout-checker"
          src={image}
          alt="Selected transparent jewellery cut-out"
        />
      )}
      <label>
        Cut-out anchor
        <select aria-label="Cut-out anchor" value={overlayAnchors[type]} disabled>
          <option value={overlayAnchors[type]}>
            {
              (
                {
                  earlobe: "Earlobe",
                  nostril: "Nostril",
                  hairParting: "Hair parting",
                  neckBase: "Neck base",
                  finger: "Finger",
                  wrist: "Wrist",
                  waist: "Waist",
                  ankle: "Ankle",
                } as Record<string, string>
              )[overlayAnchors[type]]
            }
          </option>
        </select>
      </label>
      <p className="small-footnote">
        The anchor follows the item type. Trimmed drops attach at their top centre; studs and bands
        attach at their centre.
      </p>
      {error && <p role="alert">{error}</p>}
      <label className="consent">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>I agree to store or remove this cut-out in the store catalogue.</span>
      </label>
      <button
        className="button secondary"
        disabled={busy || !image || !consent}
        onClick={() => void save()}
      >
        Save cut-out
      </button>
      {hasOverlay && (
        <button
          className="button secondary"
          disabled={busy || !consent}
          onClick={() => void save(true)}
        >
          Remove cut-out
        </button>
      )}
    </details>
  );
}
