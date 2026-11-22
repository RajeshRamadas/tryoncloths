import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { loadImage } from "./images";
import { overlayRegions } from "./jewellery-overlay";

export type OverlayPlacement = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  mirror: boolean;
  pivotX: number;
  pivotY: number;
};
export type OverlayPrepared = {
  base: string;
  asset: string;
  assetHash: string;
  placements: OverlayPlacement[];
  width: number;
  height: number;
  warning: string;
};
type Props = {
  anchor: string;
  disabled: boolean;
  onPrepare: () => Promise<OverlayPrepared | null>;
  onApply: (prepared: OverlayPrepared, placements: OverlayPlacement[]) => Promise<boolean>;
};
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const angle = (n: number) => ((n + 540) % 360) - 180;
const nudges: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
export default function JewelleryOverlay({ anchor, disabled, onPrepare, onApply }: Props) {
  const [prepared, setPrepared] = useState<OverlayPrepared | null>(null),
    [pieces, setPieces] = useState<OverlayPlacement[]>([]),
    [selected, setSelected] = useState(0),
    [zoom, setZoom] = useState(1),
    [focus, setFocus] = useState<{ x: number; y: number } | null>(null),
    [placing, setPlacing] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const canvasHelp = useId();
  const canvas = useRef<HTMLCanvasElement>(null),
    images = useRef<HTMLImageElement[]>([]),
    alive = useRef(true),
    points = useRef(new Map<number, { x: number; y: number }>()),
    gesture = useRef<{
      piece: OverlayPlacement;
      x: number;
      y: number;
      distance: number;
      angle: number;
    } | null>(null);
  const piece = pieces[selected];
  const overviewWidth = prepared?.width ?? 1;
  const overviewHeight = prepared?.height ?? 1;
  const viewWidth = overviewWidth / zoom;
  const viewHeight = overviewHeight / zoom;
  const originX = clamp(
    (focus?.x ?? overviewWidth / 2) - viewWidth / 2,
    0,
    overviewWidth - viewWidth,
  );
  const originY = clamp(
    (focus?.y ?? overviewHeight / 2) - viewHeight / 2,
    0,
    overviewHeight - viewHeight,
  );
  const regions: { label: string; index: number }[] = overlayRegions(pieces, anchor);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      images.current = [];
      points.current.clear();
      const c = canvas.current;
      if (c) {
        c.width = 0;
        c.height = 0;
      }
    };
  }, []);
  useEffect(() => {
    if (!prepared) return;
    let active = true;
    setReady(false);
    void Promise.all([loadImage(prepared.base), loadImage(prepared.asset)])
      .then((value) => {
        if (active) {
          images.current = value;
          setReady(true);
        }
      })
      .catch(() => {
        if (active) setError("The placement images could not be opened. Reload the editor.");
      });
    return () => {
      active = false;
      images.current = [];
    };
  }, [prepared]);
  useEffect(() => {
    const c = canvas.current;
    const [base, asset] = images.current;
    if (!c || !prepared || !ready || !base || !asset) return;
    const ctx = c.getContext("2d")!;
    c.width = prepared.width;
    c.height = prepared.height;
    ctx.setTransform(zoom, 0, 0, zoom, -originX * zoom, -originY * zoom);
    ctx.drawImage(base, 0, 0);
    const screenPixel = prepared.width / Math.max(1, c.clientWidth) / zoom;
    pieces.forEach((p, i) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.angle * Math.PI) / 180);
      if (p.mirror) ctx.scale(-1, 1);
      ctx.drawImage(asset, -p.pivotX * p.width, -p.pivotY * p.height, p.width, p.height);
      if (i === selected) {
        ctx.strokeStyle = "#215b4a";
        ctx.lineWidth = 1.5 * screenPixel;
        ctx.setLineDash([5 * screenPixel, 3 * screenPixel]);
        ctx.strokeRect(-p.pivotX * p.width, -p.pivotY * p.height, p.width, p.height);
        if (zoom > 1 || placing) {
          const radius = 7 * screenPixel;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(-radius, 0);
          ctx.lineTo(radius, 0);
          ctx.moveTo(0, -radius);
          ctx.lineTo(0, radius);
          ctx.stroke();
        }
      }
      ctx.restore();
    });
  }, [prepared, pieces, selected, ready, zoom, originX, originY, placing]);
  function update(next: Partial<OverlayPlacement>) {
    setPieces((list) => list.map((p, i) => (i === selected ? { ...p, ...next } : p)));
  }
  function resize(factor: number, source = piece) {
    if (!prepared || !source) return {};
    const f = clamp(
      factor,
      Math.max(2 / source.width, 2 / source.height),
      Math.min(prepared.width / source.width, prepared.height / source.height),
    );
    return { width: source.width * f, height: source.height * f };
  }
  function position(e: PointerEvent<HTMLCanvasElement>) {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return {
      x: originX + ((e.clientX - r.left - c.clientLeft) * viewWidth) / c.clientWidth,
      y: originY + ((e.clientY - r.top - c.clientTop) * viewHeight) / c.clientHeight,
    };
  }
  function target(x: number, y: number) {
    update({ x: clamp(x, 0, overviewWidth), y: clamp(y, 0, overviewHeight) });
  }
  function focusPiece(index: number, magnification: number) {
    const { x, y } = pieces[index];
    setSelected(index);
    setFocus({ x, y });
    setZoom(magnification);
  }
  function onKeyDown(e: KeyboardEvent<HTMLCanvasElement>) {
    if (disabled || !ready || !piece) return;
    if (e.key === "Escape" && placing) setPlacing(false);
    const nudge = nudges[e.key];
    if (!nudge) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    target(piece.x + nudge[0] * step, piece.y + nudge[1] * step);
  }
  function resetGesture(index = selected) {
    const p = [...points.current.values()],
      first = p[0];
    if (!first || !pieces[index]) {
      gesture.current = null;
      return;
    }
    const second = p[1];
    gesture.current = {
      piece: { ...pieces[index] },
      x: second ? (first.x + second.x) / 2 : first.x,
      y: second ? (first.y + second.y) / 2 : first.y,
      distance: second ? Math.hypot(second.x - first.x, second.y - first.y) : 0,
      angle: second ? Math.atan2(second.y - first.y, second.x - first.x) : 0,
    };
  }
  function down(e: PointerEvent<HTMLCanvasElement>) {
    if (disabled || !ready || !prepared) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    const q = position(e);
    if (placing) {
      target(q.x, q.y);
      setPlacing(false);
      return;
    }
    let index = selected;
    if (points.current.size === 0) {
      let best = Infinity;
      pieces.forEach((p, i) => {
        const distance = Math.hypot(p.x - q.x, p.y - q.y);
        if (distance < best) {
          best = distance;
          index = i;
        }
      });
      setSelected(index);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    points.current.set(e.pointerId, q);
    resetGesture(index);
  }
  function move(e: PointerEvent<HTMLCanvasElement>) {
    if (disabled || !prepared || !points.current.has(e.pointerId) || !gesture.current) return;
    e.preventDefault();
    points.current.set(e.pointerId, position(e));
    const [a, b] = [...points.current.values()],
      g = gesture.current,
      x = b ? (a.x + b.x) / 2 : a.x,
      y = b ? (a.y + b.y) / 2 : a.y;
    const next = {
      x: clamp(g.piece.x + x - g.x, 0, prepared.width),
      y: clamp(g.piece.y + y - g.y, 0, prepared.height),
      ...(b && g.distance > 0
        ? {
            ...resize(Math.hypot(b.x - a.x, b.y - a.y) / g.distance, g.piece),
            angle: angle(
              g.piece.angle + ((Math.atan2(b.y - a.y, b.x - a.x) - g.angle) * 180) / Math.PI,
            ),
          }
        : {}),
    };
    update(next);
  }
  function up(e: PointerEvent<HTMLCanvasElement>) {
    points.current.delete(e.pointerId);
    resetGesture();
  }
  async function load() {
    setError("");
    const value = await onPrepare();
    if (value && alive.current) {
      setPrepared(value);
      setPieces(value.placements.map((p) => ({ ...p })));
      setSelected(0);
      setZoom(1);
      setPlacing(false);
    }
  }
  return (
    <div className="jewellery-overlay">
      <h3>Overlay placement · free</h3>
      <p>
        Use the saved transparent cut-out. Drag a piece, or pinch with two fingers to scale and
        rotate it. No images are sent to Gemini.
      </p>
      <button className="button secondary" disabled={disabled} onClick={() => void load()}>
        {prepared ? "Reload starting placement" : "Load overlay placement"}
      </button>
      {error && <p role="alert">{error}</p>}
      {prepared && (
        <>
          <p className="small-footnote">
            {prepared.warning} The cut-out keeps its product colours and does not simulate lighting
            or occlusion.
          </p>
          <div className="jewellery-overlay-views" role="group" aria-label="Placement close-ups">
            <button
              className="button secondary"
              disabled={disabled || !ready}
              onClick={() => setZoom(1)}
            >
              Full view
            </button>
            {regions.map(({ label, index }) => (
              <button
                className="button secondary"
                key={label}
                disabled={disabled || !ready}
                onClick={() => focusPiece(index, anchor === "earlobe" ? 4 : 3)}
              >
                Zoom to {label}
              </button>
            ))}
            <label className="jewellery-overlay-zoom">
              View zoom ({zoom}×)
              <input
                type="range"
                aria-label="Placement view zoom"
                min="1"
                max="6"
                step="0.5"
                value={zoom}
                disabled={disabled || !ready}
                onChange={(e) => {
                  if (!piece) return;
                  const next = Number(e.target.value);
                  if (zoom === 1) focusPiece(selected, next);
                  else setZoom(next);
                }}
              />
            </label>
          </div>
          <canvas
            ref={canvas}
            className="jewellery-overlay-canvas"
            aria-label="Jewellery placement canvas"
            aria-describedby={canvasHelp}
            tabIndex={disabled || !ready ? -1 : 0}
            onKeyDown={onKeyDown}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onLostPointerCapture={up}
          />
          <p id={canvasHelp} className="small-footnote">
            {placing
              ? "Tap the attachment point for the selected piece."
              : "Drag to adjust. Arrow keys move the selected piece by 1 pixel."}
          </p>
          {piece && (
            <fieldset disabled={disabled || !ready}>
              <label>
                Selected overlay piece
                <select
                  aria-label="Selected overlay piece"
                  value={selected}
                  onChange={(e) => focusPiece(Number(e.target.value), zoom)}
                >
                  {pieces.map((p, i) => (
                    <option key={p.id} value={i}>
                      {p.id.split(":")[0]} · piece {Number(p.id.split(":")[1]) + 1}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button secondary"
                aria-pressed={placing}
                onClick={() => setPlacing(!placing)}
              >
                {placing ? "Cancel placement" : "Set attachment point"}
              </button>
              <div className="catalogue-filters">
                <label>
                  Horizontal position
                  <input
                    aria-label="Overlay horizontal position"
                    type="number"
                    min="0"
                    max={prepared.width}
                    step="any"
                    value={Math.round(piece.x)}
                    onChange={(e) =>
                      update({ x: clamp(Number(e.target.value), 0, prepared.width) })
                    }
                  />
                </label>
                <label>
                  Vertical position
                  <input
                    aria-label="Overlay vertical position"
                    type="number"
                    min="0"
                    max={prepared.height}
                    step="any"
                    value={Math.round(piece.y)}
                    onChange={(e) =>
                      update({ y: clamp(Number(e.target.value), 0, prepared.height) })
                    }
                  />
                </label>
              </div>
              <label>
                Overlay scale (
                {Math.round((piece.width / prepared.placements[selected].width) * 100)}%)
                <input
                  aria-label="Overlay scale"
                  type="range"
                  min="10"
                  max="400"
                  step="1"
                  value={(piece.width / prepared.placements[selected].width) * 100}
                  onChange={(e) =>
                    update(resize(Number(e.target.value) / 100, prepared.placements[selected]))
                  }
                />
              </label>
              <label>
                Overlay rotation ({Math.round(piece.angle)}°)
                <input
                  aria-label="Overlay rotation"
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={piece.angle}
                  onChange={(e) => update({ angle: Number(e.target.value) })}
                />
              </label>
              <label className="consent">
                <input
                  type="checkbox"
                  checked={piece.mirror}
                  onChange={(e) => update({ mirror: e.target.checked })}
                />
                <span>Mirror selected piece</span>
              </label>
              <button
                className="button secondary"
                onClick={() => {
                  setPieces(prepared.placements.map((p) => ({ ...p })));
                  setSelected(0);
                  setZoom(1);
                  setPlacing(false);
                }}
              >
                Reset all placements
              </button>
              <button
                className="button primary full-width"
                onClick={() =>
                  void onApply(prepared, pieces).then((applied) => {
                    if (applied && alive.current) setPrepared(null);
                  })
                }
              >
                Apply overlay — free
              </button>
            </fieldset>
          )}
        </>
      )}
    </div>
  );
}
