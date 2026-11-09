import { useEffect, useState } from "react";
import { sizeApi } from "./size-api";
export default function PurchaseLook({
  lookId,
  disabled = false,
  initialPurchase,
}: {
  lookId: string;
  disabled?: boolean;
  initialPurchase?: { purchasedAt: number | null; purchasedSize: string | null };
}) {
  const [purchase, setPurchase] = useState<{
      purchasedAt: number | null;
      purchasedSize: string | null;
    } | null>(initialPurchase || null),
    [size, setSize] = useState(""),
    [busy, setBusy] = useState(!initialPurchase),
    [error, setError] = useState("");
  useEffect(() => {
    if (initialPurchase) {
      setPurchase(initialPurchase);
      setBusy(false);
      return;
    }
    let live = true;
    void sizeApi(`/api/looks/${encodeURIComponent(lookId)}/purchase`)
      .then((result) => {
        if (live) setPurchase(result);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [lookId]);
  async function update(undo = false) {
    setBusy(true);
    setError("");
    try {
      setPurchase(
        await sizeApi(
          `/api/looks/${encodeURIComponent(lookId)}/purchase`,
          undo ? "DELETE" : "POST",
          undo ? undefined : { size },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="purchase-look" aria-label="Purchase status">
      <h3>Purchase status</h3>
      {purchase?.purchasedAt ? (
        <>
          <p>
            Purchased · {purchase.purchasedSize} ·{" "}
            {new Date(purchase.purchasedAt).toLocaleDateString()}
          </p>
          <button
            className="button secondary"
            disabled={disabled || busy}
            onClick={() => void update(true)}
          >
            Undo purchase mark
          </button>
        </>
      ) : (
        <>
          <label>
            Purchased size
            <input
              value={size}
              maxLength={30}
              disabled={disabled || busy}
              placeholder="Confirm size with the customer"
              onChange={(e) => setSize(e.target.value)}
            />
          </label>
          <button
            className="button secondary"
            disabled={disabled || busy || !size.trim()}
            onClick={() => void update()}
          >
            Mark purchased
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
