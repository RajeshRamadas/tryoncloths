import { useEffect, useRef, useState } from "react";
import JewelleryMeasurementFields from "./JewelleryMeasurementFields";
import { jewelleryApi } from "./jewellery-api";
import {
  jewelleryMeasurementsForm,
  jewelleryMeasurementsInput,
  ringSuggestion,
  bangleSuggestion,
} from "./jewellery-sizing";
import type { CustomerMeasurements } from "./customers";
import type { JewelleryAttributes, JewelleryType } from "./jewellery-types";
type Profile = { id: string; name: string; measurements: CustomerMeasurements | null };
export default function JewellerySizeHelp({
  avatarId,
  type,
  attributes,
  hand,
  finger,
  wrist,
  disabled,
}: {
  avatarId: string;
  type: JewelleryType;
  attributes: JewelleryAttributes;
  hand: string;
  finger: string;
  wrist: string;
  disabled: boolean;
}) {
  const [profile, setProfile] = useState<Profile | null>(null),
    [values, setValues] = useState<Record<string, string>>(() => jewelleryMeasurementsForm()),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const alive = useRef(true),
    version = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      version.current++;
      controller.current?.abort();
    };
  }, [avatarId]);
  async function load() {
    const epoch = ++version.current,
      abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setBusy(true);
    setError("");
    try {
      const data = await jewelleryApi(
        "/api/jewellery/size?avatarId=" + encodeURIComponent(avatarId),
        undefined,
        abort.signal,
      );
      if (alive.current && version.current === epoch) {
        setProfile(data.customer);
        setValues(jewelleryMeasurementsForm(data.customer?.measurements));
        setLoaded(true);
        setDirty(false);
        setConsent(false);
      }
    } catch (e) {
      if (alive.current && version.current === epoch)
        setError(
          "Sizing help is unavailable. You can continue trying jewellery. " + (e as Error).message,
        );
    } finally {
      if (alive.current && version.current === epoch) setBusy(false);
    }
  }
  async function save() {
    const epoch = ++version.current,
      abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await jewelleryApi(
        "/api/jewellery/size",
        {
          avatarId,
          customerId: profile!.id,
          measurements: jewelleryMeasurementsInput(values),
          storageConsent: true,
        },
        abort.signal,
      );
      if (alive.current && version.current === epoch) {
        setProfile(data.customer);
        setValues(jewelleryMeasurementsForm(data.customer.measurements));
        setConsent(false);
        setDirty(false);
        setNotice("Jewellery measurements saved to the customer profile. No AI credit used.");
      }
    } catch (e) {
      if (alive.current && version.current === epoch) setError((e as Error).message);
    } finally {
      if (alive.current && version.current === epoch) setBusy(false);
    }
  }
  const input = jewelleryMeasurementsInput(values),
    isRing = type === "ring",
    suggestion = isRing ? ringSuggestion(input) : bangleSuggestion(input),
    catalogue = isRing ? attributes.ringSizeIn : attributes.bangleSize;
  return (
    <aside className="jewellery-size-help" aria-label="Jewellery sizing help">
      <h3>Size help · optional</h3>
      <p>
        {isRing
          ? "Confirm these saved values apply to the customer’s " + hand + " " + finger + " finger."
          : "Confirm these saved values apply to " +
            (wrist === "both" ? "both hands" : `the customer’s ${wrist} hand`) +
            "."}
      </p>
      <p className="size-help-result" role="status">
        {suggestion.size !== null
          ? `Suggested ${isRing ? "Indian ring" : "bangle"} size ${suggestion.size} · ${suggestion.confidence} confidence`
          : "No size suggestion yet · Low confidence"}
      </p>
      <p>{suggestion.reason}</p>
      {suggestion.alternatives.length > 0 && (
        <p>Also compare: {suggestion.alternatives.join(", ")}.</p>
      )}
      {catalogue !== undefined && (
        <p>
          Catalogue size {catalogue}
          {suggestion.size !== null
            ? String(catalogue) === String(suggestion.size)
              ? " matches this suggestion."
              : " differs from this suggestion; check it in store."
            : "."}{" "}
          Try-on remains available.
        </p>
      )}
      <p className="small-footnote">
        Guidance uses a pilot reference chart, not the jeweller’s certified sizing chart. It never
        changes the catalogue size or prevents a try-on. Measurements are not sent to Gemini.
      </p>
      {dirty && <p>Unsaved measurement preview</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {profile ? (
        <details>
          <summary>Customer measurements · {profile.name}</summary>
          <JewelleryMeasurementFields
            values={values}
            disabled={disabled || busy}
            onChange={(key, value) => {
              setValues((v) => ({ ...v, [key]: value }));
              setDirty(true);
              setConsent(false);
              setNotice("");
            }}
          />
          <label className="consent">
            <input
              type="checkbox"
              checked={consent}
              disabled={disabled || busy || !dirty}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>The customer agrees to save these jewellery measurements to their profile.</span>
          </label>
          <div className="customer-actions">
            <button
              className="button secondary"
              disabled={disabled || busy || !consent || !dirty}
              onClick={() => void save()}
            >
              Save jewellery measurements
            </button>
            <button
              className="button secondary"
              disabled={disabled || busy}
              onClick={() => void load()}
            >
              Reload saved measurements
            </button>
          </div>
        </details>
      ) : loaded ? (
        <p>
          This avatar is not linked to a customer profile. In Forme, select a customer and save the
          avatar under that customer to keep jewellery measurements for later visits.
        </p>
      ) : (
        !error && <p>Opening saved size measurements…</p>
      )}
    </aside>
  );
}
