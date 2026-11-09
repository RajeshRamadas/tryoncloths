import { useEffect, useRef, useState } from "react";
import { jewelleryApi, type JewelleryItem, type JewelleryResult } from "./jewellery-api";
import { previewLabel } from "./jewellery-overlay";
type Entry = { item: JewelleryItem; result: JewelleryResult; approved?: boolean };
type Quote = {
  credits: number;
  quote: string;
  runnable: boolean;
  variants: { item: JewelleryItem; credits: number; reused: boolean }[];
};
type Props = {
  item: JewelleryItem;
  disabled: boolean;
  payload: Record<string, unknown>;
  request: (label: string, path: string, body: unknown, timeout?: number) => Promise<any>;
  onAdopt: (entry: Entry) => void;
  onDownload: (result: JewelleryResult) => void;
};
export default function JewelleryCompare({
  item,
  disabled,
  payload,
  request,
  onAdopt,
  onDownload,
}: Props) {
  const [variants, setVariants] = useState<JewelleryItem[]>([]),
    [target, setTarget] = useState(""),
    [quote, setQuote] = useState<Quote | null>(null),
    [consent, setConsent] = useState(false),
    [results, setResults] = useState<Entry[]>([]),
    [review, setReview] = useState<Record<string, boolean>>({}),
    [storage, setStorage] = useState(false),
    [notice, setNotice] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void jewelleryApi(
      "/api/jewellery/variants/" + encodeURIComponent(item.id),
      undefined,
      controller.signal,
    )
      .then((d) => {
        if (alive.current) {
          setVariants(d.variants);
          setTarget(d.variants.find((v: JewelleryItem) => v.id !== item.id)?.id || "");
        }
      })
      .catch(() => {});
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [item.id]);
  const body = { ...payload, itemIds: [item.id, target] };
  async function check() {
    const data = await request("Checking comparison cost", "/api/jewellery/compare", {
      ...body,
      action: "quote",
    });
    if (alive.current && data) {
      setQuote(data);
      setConsent(false);
      setNotice("Cost checked. No image request was made.");
    }
  }
  async function run() {
    if (!quote || !consent) return;
    setConsent(false);
    const data = await request(
      "Comparing two jewellery variants",
      "/api/jewellery/compare",
      {
        ...body,
        action: "run",
        quote: quote.quote,
        consent: true,
        consentScope: "compare-two-variants",
        consentProvider: "gemini",
        requestIds: [crypto.randomUUID(), crypto.randomUUID()],
      },
      420000,
    );
    if (alive.current && data) {
      setResults(data.results.map((e: Entry) => ({ ...e, approved: e.result.reused })));
      setQuote(null);
      setReview({});
      setStorage(false);
      setNotice(
        data.partial
          ? data.error
          : `Comparison ready · ${data.creditsUsed} AI credits used. Review each variant before keeping it.`,
      );
    }
    window.dispatchEvent(new Event("forme-credits-changed"));
  }
  async function save() {
    for (const entry of results) {
      if (entry.approved || !review[entry.item.id] || !entry.result.receipt) continue;
      const data = await request(
        "Saving reviewed variant",
        "/api/jewellery/results/" + entry.result.resultId + "/approve",
        {
          image: entry.result.image,
          receipt: entry.result.receipt,
          reviewed: true,
          storageConsent: true,
        },
      );
      if (!alive.current || !data) return;
      setResults((list) => list.map((e) => (e === entry ? { ...e, approved: true } : e)));
    }
    if (alive.current) {
      setStorage(false);
      setNotice("Reviewed variants saved. An exact approved comparison can now be reused free.");
    }
  }
  return (
    <section className="jewellery-compare">
      <h3>Compare metals and variants</h3>
      <p>
        Compare two linked designs on the same starting view. Each new variant uses one AI credit;
        approved exact matches are reused free.
      </p>
      {!target ? (
        <p>
          Link another metal or colour variant to this design in the{" "}
          <a href="/jewellery-catalogue">jewellery catalogue</a> first.
        </p>
      ) : (
        <>
          <label>
            Compare with jewellery variant
            <select
              aria-label="Compare with jewellery variant"
              value={target}
              disabled={disabled || !!results.length}
              onChange={(e) => {
                setTarget(e.target.value);
                setQuote(null);
                setConsent(false);
              }}
            >
              {variants
                .filter((v) => v.id !== item.id)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.attributes.metal.replaceAll("_", " ")}
                  </option>
                ))}
            </select>
          </label>
          <button className="button secondary" disabled={disabled} onClick={() => void check()}>
            Check comparison cost — free
          </button>
          {quote && (
            <div className="comparison-cost" role="status">
              <strong>
                Comparison cost: {quote.credits} AI credit{quote.credits === 1 ? "" : "s"}
              </strong>
              <ul>
                {quote.variants.map((v) => (
                  <li key={v.item.id}>
                    {v.item.name}: {v.reused ? "approved reuse · free" : "1 AI credit"}
                  </li>
                ))}
              </ul>
              {!quote.runnable && (
                <p>
                  New AI images are unavailable. Approved exact comparisons can still be reused.
                </p>
              )}
            </div>
          )}
          <label className="consent">
            <input
              type="checkbox"
              disabled={disabled || !quote?.runnable}
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              The customer agrees to compare both selected variants with Google Gemini at the
              displayed cost.
            </span>
          </label>
          <button
            className="button primary full-width"
            disabled={disabled || !quote?.runnable || !consent}
            onClick={() => void run()}
          >
            Compare both variants
            {quote ? " — " + quote.credits + " AI credit" + (quote.credits === 1 ? "" : "s") : ""}
          </button>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {!!results.length && (
        <>
          <div className="jewellery-compare-grid">
            {results.map((entry) => (
              <article key={entry.item.id}>
                <h4>{entry.item.name}</h4>
                <img src={entry.result.image} alt={entry.item.name + " comparison preview"} />
                <p className="small-footnote">{previewLabel(entry.result.previewMode)}</p>
                <label className="consent">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={!!review[entry.item.id]}
                    onChange={(e) => {
                      setReview((r) => ({ ...r, [entry.item.id]: e.target.checked }));
                      setStorage(false);
                    }}
                  />
                  <span>I reviewed {entry.item.name}.</span>
                </label>
                {entry.approved && <p>Approved reuse saved</p>}
                {!entry.result.receipt && !entry.result.reused && (
                  <p>
                    Save verification is unavailable. Download this paid result; no automatic
                    regeneration will run.
                  </p>
                )}
                <button
                  className="button secondary"
                  disabled={disabled || !review[entry.item.id]}
                  onClick={() => onDownload(entry.result)}
                >
                  Download {entry.item.name}
                </button>
                <button
                  className="button primary"
                  disabled={disabled || !review[entry.item.id]}
                  onClick={() => onAdopt(entry)}
                >
                  Use {entry.item.name}
                </button>
              </article>
            ))}
          </div>
          <p>
            Save both reviewed variants before choosing one if you want to reuse both later.
            Choosing a variant adds it to this view’s jewellery set.
          </p>
          <label className="consent">
            <input
              type="checkbox"
              checked={storage}
              disabled={
                disabled ||
                !results.some((e) => review[e.item.id] && !e.approved && e.result.receipt)
              }
              onChange={(e) => setStorage(e.target.checked)}
            />
            <span>The customer agrees to save the reviewed comparison variants for reuse.</span>
          </label>
          <button
            className="button secondary"
            disabled={disabled || !storage}
            onClick={() => void save()}
          >
            Save reviewed variants for reuse
          </button>
        </>
      )}
    </section>
  );
}
