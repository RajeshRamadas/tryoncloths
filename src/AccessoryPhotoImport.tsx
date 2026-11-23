import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  MAX_ACCESSORIES_PER_PHOTO,
  separateAccessories,
  traceAccessory,
  type Point,
  type Selection,
} from "./accessory-regions";
import { catalogueApi } from "./catalogue";
import { removeBackground, transparentShare } from "./jewellery-cutout";
import { decodeCutoutPhoto, encodeCutoutPng, type Source } from "./jewellery-cutout-photo";
import { overlayAnchors } from "./jewellery-overlay";
import {
  jewelleryChoices,
  jewelleryMetals,
  jewelleryTypes,
  type JewelleryType,
} from "./jewellery-types";

type Piece = {
  id: number;
  bounds: Selection["bounds"];
  png: string;
  name: string;
  type: JewelleryType | "";
  metal: string;
  pair: boolean;
  saved?: string;
  error?: string;
};
const MAX_POINTS = 60;

export default function AccessoryPhotoImport({
  disabled,
  onSaved,
}: {
  disabled: boolean;
  onSaved: () => void;
}) {
  const [photo, setPhoto] = useState<Source | null>(null);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [tracing, setTracing] = useState(false);
  const [outline, setOutline] = useState<Point[]>([]);
  const [contours, setContours] = useState<Point[][]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const displayed = useRef<HTMLCanvasElement>(null);
  const operation = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const locked = disabled || !!busy;
  const pending = pieces.filter((piece) => !piece.saved);
  const canFinishOutline = outline.length >= 3 || (contours.length > 0 && outline.length === 0);
  const canSave =
    pending.length > 0 &&
    !locked &&
    !tracing &&
    consent &&
    pending.every((piece) => piece.name.trim() && piece.type && piece.metal);

  useEffect(() => () => operation.current?.abort(), []);

  const original = useMemo(() => {
    if (!photo) return null;
    const canvas = document.createElement("canvas");
    canvas.width = photo.width;
    canvas.height = photo.height;
    canvas
      .getContext("2d")!
      .putImageData(
        new ImageData(new Uint8ClampedArray(photo.rgba), photo.width, photo.height),
        0,
        0,
      );
    return canvas;
  }, [photo]);

  useEffect(() => {
    const context = displayed.current?.getContext("2d");
    if (!context || !original) return;
    context.clearRect(0, 0, original.width, original.height);
    context.drawImage(original, 0, 0);
    const line = Math.max(2, original.width / 160);
    context.lineWidth = line;
    context.strokeStyle = "#146557";
    context.font = `bold ${Math.round(line * 3.2)}px sans-serif`;
    for (const { id, bounds } of pieces) {
      const { left, top, right, bottom } = bounds;
      context.strokeRect(left, top, right - left, bottom - top);
      context.fillStyle = "#146557";
      context.fillRect(left, top, line * 6, line * 5);
      context.fillStyle = "#ffffff";
      context.fillText(String(id), left + line, top + line * 3.7);
    }
    if (!tracing) return;
    context.strokeStyle = "#ffffff";
    context.shadowColor = "#21372c";
    context.shadowBlur = line;
    for (const contour of contours) {
      context.beginPath();
      contour.forEach(({ x, y }) => context.lineTo(x, y));
      context.closePath();
      context.stroke();
    }
    context.beginPath();
    outline.forEach(({ x, y }) => context.lineTo(x, y));
    context.stroke();
    for (const { x, y } of outline) {
      context.beginPath();
      context.arc(x, y, line, 0, Math.PI * 2);
      context.fillStyle = "#ffffff";
      context.fill();
    }
    if (cursor) {
      const { x, y } = cursor;
      context.beginPath();
      context.moveTo(x - line * 3, y);
      context.lineTo(x + line * 3, y);
      context.moveTo(x, y - line * 3);
      context.lineTo(x, y + line * 3);
      context.stroke();
    }
    context.shadowBlur = 0;
  }, [original, pieces, outline, contours, tracing, cursor]);

  function begin(message: string) {
    operation.current?.abort();
    const abort = new AbortController();
    operation.current = abort;
    setBusy(message);
    setError("");
    setNotice("");
    return abort.signal;
  }
  async function makePiece(selection: Selection): Promise<Piece> {
    const png = await encodeCutoutPng(selection.source);
    return {
      id: nextId.current++,
      bounds: selection.bounds,
      png,
      name: "",
      type: "",
      metal: "",
      pair: false,
    };
  }
  async function upload(file: File) {
    const signal = begin("Finding accessories…");
    try {
      const source = await decodeCutoutPhoto(file, 64);
      if (signal.aborted) return;
      setPhoto(source);
      setPieces([]);
      setConsent(false);
      setOutline([]);
      setContours([]);
      setTracing(false);
      setCursor(null);
      nextId.current = 1;
      let prepared: Selection[] = [];
      try {
        const foreground =
          transparentShare(source.rgba) >= 0.01
            ? source
            : { ...source, rgba: removeBackground(source.rgba, source.width, source.height).rgba };
        prepared = separateAccessories(foreground);
      } catch {
        // A busy background still supports manual tracing from the source pixels.
      }
      const found: Piece[] = [];
      for (const selection of prepared) {
        if (signal.aborted) return;
        try {
          found.push(await makePiece(selection));
        } catch {
          // Keep other usable suggestions. This region can still be traced.
        }
      }
      if (signal.aborted) return;
      setPieces(found);
      setNotice(
        found.length
          ? `${found.length} ${found.length === 1 ? "cut-out ready" : "cut-outs ready"} to review. Trace any missed pieces.`
          : "Trace each accessory to separate it from the background.",
      );
    } catch (cause) {
      if (!signal.aborted) setError((cause as Error).message);
    } finally {
      if (!signal.aborted) setBusy("");
    }
  }
  function addPoint(point: Point) {
    setCursor(null);
    setOutline((points) => (points.length < MAX_POINTS ? [...points, point] : points));
  }
  function mark(event: MouseEvent<HTMLCanvasElement>) {
    if (!tracing || locked || !original) return;
    const rect = event.currentTarget.getBoundingClientRect();
    addPoint({
      x: Math.max(
        0,
        Math.min(original.width, ((event.clientX - rect.left) * original.width) / rect.width),
      ),
      y: Math.max(
        0,
        Math.min(original.height, ((event.clientY - rect.top) * original.height) / rect.height),
      ),
    });
  }
  function position(event: KeyboardEvent<HTMLCanvasElement>) {
    if (!tracing || locked || !original) return;
    const point = cursor ?? { x: original.width / 2, y: original.height / 2 };
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      addPoint(point);
      setCursor(point);
      return;
    }
    const moves: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const step = Math.max(1, Math.round(original.width / (event.shiftKey ? 20 : 100)));
    setCursor({
      x: Math.max(0, Math.min(original.width, point.x + move.x * step)),
      y: Math.max(0, Math.min(original.height, point.y + move.y * step)),
    });
  }
  async function finishOutline() {
    if (!original || !canFinishOutline || pieces.length >= MAX_ACCESSORIES_PER_PHOTO) return;
    const signal = begin("Cutting out the accessory…");
    try {
      const [outside, ...openings] = outline.length ? [...contours, outline] : contours;
      const piece = await makePiece(traceAccessory(original, outside, openings));
      if (signal.aborted) return;
      setPieces((previous) => [...previous, piece]);
      setTracing(false);
      setOutline([]);
      setContours([]);
      setCursor(null);
      setNotice("Cut-out added. Review it before saving.");
    } catch (cause) {
      if (!signal.aborted) setError((cause as Error).message);
    } finally {
      if (!signal.aborted) setBusy("");
    }
  }
  function update(id: number, changes: Partial<Piece>) {
    setPieces((previous) =>
      previous.map((piece) => (piece.id === id ? { ...piece, ...changes } : piece)),
    );
  }
  async function save() {
    if (!canSave) return;
    const signal = begin("Saving reviewed accessories…");
    let saved = 0;
    for (const piece of pending) {
      if (signal.aborted || !piece.type) break;
      update(piece.id, { error: undefined });
      try {
        const result = await catalogueApi("/api/garments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            category: "jewellery",
            name: piece.name,
            garmentType: piece.type,
            attributes: { metal: piece.metal, pair: piece.pair },
            image: piece.png,
            overlayPng: piece.png,
            overlayAnchor: overlayAnchors[piece.type],
            stock: "in",
            storageConsent: true,
          }),
        });
        if (signal.aborted) return;
        update(piece.id, {
          saved: result.duplicate ? "Already in the catalogue" : "Saved for try-on",
        });
        saved++;
      } catch (cause) {
        if (!signal.aborted) update(piece.id, { error: (cause as Error).message });
      }
    }
    if (signal.aborted) return;
    setBusy("");
    if (saved) {
      setNotice(
        `${saved} ${saved === 1 ? "piece ready" : "pieces ready"} in the jewellery catalogue.`,
      );
      onSaved();
    }
    if (saved < pending.length) setError("Check the items with errors and retry those pieces.");
    else setConsent(false);
  }

  return (
    <section className="accessory-photo-import">
      <details>
        <summary>Add several accessories from one photo</summary>
        <p>
          Upload a PNG, JPEG or WebP up to 10 MB. Each piece gets its own catalogue item and
          cut-out.
        </p>
        <label>
          Group accessory photo
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={locked}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
        {busy && <p role="status">{busy}</p>}
        {notice && !busy && <p role="status">{notice}</p>}
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {photo && (
          <>
            <canvas
              ref={displayed}
              width={photo.width}
              height={photo.height}
              tabIndex={tracing ? 0 : -1}
              aria-label="Group photo with marked accessories"
              aria-describedby={tracing ? "accessory-outline-help" : undefined}
              onClick={mark}
              onKeyDown={position}
            />
            {tracing ? (
              <>
                <p id="accessory-outline-help">
                  {contours.length
                    ? "Tap around the inside of the opening to clear it."
                    : "Tap around the outside of one accessory."}{" "}
                  With a keyboard, move with the arrow keys and press Enter to mark each point.
                </p>
                <div className="customer-actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={locked || (!outline.length && !contours.length)}
                    onClick={() => {
                      if (outline.length) setOutline(outline.slice(0, -1));
                      else {
                        setOutline(contours[contours.length - 1]);
                        setContours(contours.slice(0, -1));
                      }
                    }}
                  >
                    Undo point
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    disabled={locked || !canFinishOutline}
                    onClick={() => void finishOutline()}
                  >
                    Finish outline
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={locked || outline.length < 3 || contours.length >= 5}
                    onClick={() => {
                      setContours([...contours, outline]);
                      setOutline([]);
                      setCursor(null);
                      displayed.current?.focus();
                    }}
                  >
                    {contours.length ? "Trace another opening" : "Trace an opening"}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={locked}
                    onClick={() => setTracing(false)}
                  >
                    Cancel outline
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                className="button secondary"
                disabled={locked || pieces.length >= MAX_ACCESSORIES_PER_PHOTO}
                onClick={() => {
                  setTracing(true);
                  setOutline([]);
                  setContours([]);
                  setCursor(null);
                  setError("");
                  displayed.current?.focus();
                }}
              >
                Trace a piece
              </button>
            )}
            {pieces.length === MAX_ACCESSORIES_PER_PHOTO && (
              <p>
                Review up to {MAX_ACCESSORIES_PER_PHOTO} pieces at a time. Dismiss a saved piece or
                remove an unwanted cut-out to add another.
              </p>
            )}
          </>
        )}
        {!!pieces.length && (
          <div className="accessory-import-pieces">
            {pieces.map((piece) => (
              <fieldset key={piece.id} disabled={locked || tracing}>
                <legend>Piece {piece.id}</legend>
                <img
                  className="cutout-checker"
                  src={piece.png}
                  alt={`Cut-out for piece ${piece.id}`}
                />
                {piece.saved ? (
                  <p>
                    {piece.name} · {piece.saved}
                  </p>
                ) : (
                  <>
                    <label>
                      Item name
                      <input
                        value={piece.name}
                        maxLength={100}
                        onChange={(e) => update(piece.id, { name: e.target.value })}
                      />
                    </label>
                    <label>
                      Jewellery type
                      <select
                        value={piece.type}
                        onChange={(e) => {
                          const type = e.target.value as Piece["type"];
                          update(piece.id, {
                            type,
                            pair: type ? jewelleryTypes[type].pair : false,
                          });
                        }}
                      >
                        <option value="">Choose type</option>
                        {jewelleryChoices.map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Metal
                      <select
                        value={piece.metal}
                        onChange={(e) => update(piece.id, { metal: e.target.value })}
                      >
                        <option value="">Choose metal</option>
                        {jewelleryMetals.map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {piece.type && jewelleryTypes[piece.type].pair && (
                      <label className="consent">
                        <input
                          type="checkbox"
                          checked={piece.pair}
                          onChange={(e) => update(piece.id, { pair: e.target.checked })}
                        />
                        <span>Use this design as a matched pair</span>
                      </label>
                    )}
                    {piece.error && (
                      <p role="alert" className="error-banner">
                        {piece.error}
                      </p>
                    )}
                  </>
                )}
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setPieces((previous) => previous.filter((p) => p.id !== piece.id))}
                >
                  {piece.saved ? "Dismiss saved piece" : "Remove cut-out"}
                </button>
              </fieldset>
            ))}
          </div>
        )}
        {!!pending.length && (
          <>
            <label className="consent">
              <input
                type="checkbox"
                disabled={locked || tracing}
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>I agree to save these reviewed cut-outs in the store catalogue.</span>
            </label>
            <button
              type="button"
              className="button primary"
              disabled={!canSave}
              onClick={() => void save()}
            >
              Save {pending.length} {pending.length === 1 ? "piece" : "pieces"}
            </button>
          </>
        )}
        {pieces.some((piece) => piece.saved) && (
          <p>
            <a href="/jewellery">Open jewellery studio</a>
          </p>
        )}
      </details>
    </section>
  );
}
