import { useEffect, useRef, useState } from "react";
import { jewelleryApi } from "./jewellery-api";
import { catalogueApi } from "./catalogue";
import type { JewelleryItem } from "./jewellery-api";
export default function JewelleryVariantLink({
  item,
  onSaved,
}: {
  item: JewelleryItem;
  onSaved: () => void;
}) {
  const [search, setSearch] = useState(""),
    [choices, setChoices] = useState<JewelleryItem[]>([]),
    [parent, setParent] = useState(item.attributes.variantOf || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    const expired = () => {
      controller.current?.abort();
      setChoices([]);
      setParent("");
    };
    window.addEventListener("forme-account-expired", expired);
    return () => {
      alive.current = false;
      controller.current?.abort();
      window.removeEventListener("forme-account-expired", expired);
    };
  }, []);
  async function find() {
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({
          category: "jewellery",
          type: item.garmentType,
          stock: "all",
          search,
          limit: "50",
        }),
        data = await jewelleryApi("/api/catalogue?" + query, undefined, abort.signal);
      if (alive.current && !abort.signal.aborted)
        setChoices(
          data.garments.filter((c: JewelleryItem) => c.id !== item.id && !c.attributes.variantOf),
        );
    } catch (e) {
      if (alive.current && !abort.signal.aborted) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function save() {
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    try {
      const { variantOf, ...attributes } = item.attributes;
      await catalogueApi("/api/catalogue/" + encodeURIComponent(item.id) + "?category=jewellery", {
        method: "PATCH",
        signal: abort.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attributes: { ...attributes, ...(parent ? { variantOf: parent } : {}) },
        }),
      });
      if (alive.current && !abort.signal.aborted) onSaved();
    } catch (e) {
      if (alive.current && !abort.signal.aborted) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <details className="jewellery-cutout">
      <summary>Link metal / colour variants{item.attributes.variantOf ? " · linked" : ""}</summary>
      <p>
        Keep the original design as the first item. Link each metal or stone variant to that
        original to compare them in the studio. Each variant keeps its own photo and approved reuse.
      </p>
      <label>
        Find original design
        <input
          value={search}
          maxLength={120}
          disabled={busy}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <button className="button secondary" disabled={busy} onClick={() => void find()}>
        Find original jewellery
      </button>
      <label>
        Original jewellery design
        <select
          aria-label="Original jewellery design"
          value={parent}
          disabled={busy}
          onChange={(e) => setParent(e.target.value)}
        >
          <option value="">Standalone original · no link</option>
          {parent && !choices.some((c) => c.id === parent) && (
            <option value={parent}>Current saved original</option>
          )}
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.attributes.metal.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <button className="button secondary" disabled={busy} onClick={() => void save()}>
        Save variant link
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
