import { useEffect, useRef, useState } from "react";
import { jewelleryApi, blobData } from "./jewellery-api";
import { overlayAnchors } from "./jewellery-overlay";
import {
  removeBackground,
  transparentShare,
  CUTOUT_DEFAULT_TOLERANCE,
  CUTOUT_MIN_TOLERANCE,
  CUTOUT_MAX_TOLERANCE,
} from "./jewellery-cutout";
import { decodeCutoutPhoto, encodeCutoutPng, type Source } from "./jewellery-cutout-photo";
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
    [error, setError] = useState(""),
    [source, setSource] = useState<Source | null>(null),
    [tolerance, setTolerance] = useState(CUTOUT_DEFAULT_TOLERANCE),
    [clearEnclosed, setClearEnclosed] = useState(true),
    [notice, setNotice] = useState("");
  const version = useRef(0),
    abort = useRef<AbortController | null>(null);
  useEffect(() => {
    const clear = () => {
      version.current++;
      abort.current?.abort();
      setImage("");
      setSource(null);
      setNotice("");
      setConsent(false);
    };
    window.addEventListener("forme-account-expired", clear);
    return () => {
      clear();
      window.removeEventListener("forme-account-expired", clear);
    };
  }, []);
  async function cutout(src: Source, tol: number, enclosed: boolean, v: number) {
    const result = removeBackground(src.rgba, src.width, src.height, {
      tolerance: tol,
      clearEnclosed: enclosed,
    });
    const data = await encodeCutoutPng({ ...src, rgba: result.rgba });
    if (v === version.current) {
      setImage(data);
      setNotice("Background removed on this device. Check the edges before saving.");
    }
  }
  async function read(file: File) {
    const v = ++version.current;
    setError("");
    setNotice("");
    setImage("");
    setSource(null);
    setConsent(false);
    try {
      const decoded = await decodeCutoutPhoto(file);
      if (v !== version.current) return;
      if (file.type === "image/png" && transparentShare(decoded.rgba) >= 0.01) {
        // Already a transparent cut-out: keep it as supplied.
        if (file.size > 2 * 1024 * 1024) throw new Error("Choose a transparent PNG under 2 MB.");
        const data = await blobData(file);
        if (v === version.current) {
          setImage(data);
          setNotice("Transparent PNG used as supplied.");
        }
        return;
      }
      setSource(decoded);
      await cutout(decoded, tolerance, clearEnclosed, v);
    } catch (e) {
      if (v === version.current) setError((e as Error).message);
    }
  }
  async function adjust(tol: number, enclosed: boolean) {
    setTolerance(tol);
    setClearEnclosed(enclosed);
    if (!source) return;
    const v = ++version.current;
    setError("");
    setConsent(false);
    try {
      await cutout(source, tol, enclosed, v);
    } catch (e) {
      if (v === version.current) {
        setImage("");
        setError((e as Error).message);
      }
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
        setSource(null);
        setNotice("");
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
        Add a single piece: a transparent PNG, or a product photo on a plain backdrop (PNG, JPEG or
        WebP under 10 MB, at least 200 × 200 px). The background is removed on this device with no
        AI credit. A paired earring is mirrored in the editor.
      </p>
      <label>
        Cut-out photo
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
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
      {notice && <p className="small-footnote">{notice}</p>}
      {source && (
        <>
          <label>
            Background tolerance
            <input
              type="range"
              min={CUTOUT_MIN_TOLERANCE}
              max={CUTOUT_MAX_TOLERANCE}
              step={4}
              value={tolerance}
              disabled={busy}
              onChange={(e) => void adjust(Number(e.target.value), clearEnclosed)}
            />
          </label>
          <label className="consent">
            <input
              type="checkbox"
              checked={clearEnclosed}
              disabled={busy}
              onChange={(e) => void adjust(tolerance, e.target.checked)}
            />
            <span>Clear enclosed gaps, such as ring holes and chain loops</span>
          </label>
          <p className="small-footnote">
            Raise the tolerance if backdrop remains; lower it if light metal or stones are cut away.
          </p>
        </>
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
                  hairSide: "Side of the head",
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
