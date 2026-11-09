import { useEffect, useState } from "react";
import { sizeApi, type SizeSuggestionData } from "./size-api";
export default function SizeSuggestion({
  customerId,
  garmentId,
}: {
  customerId: string;
  garmentId: string;
}) {
  const [data, setData] = useState<SizeSuggestionData | null>(null),
    [message, setMessage] = useState("Checking the size chart…");
  useEffect(() => {
    let live = true;
    setData(null);
    setMessage("Checking the size chart…");
    void sizeApi(
      `/api/size?customer=${encodeURIComponent(customerId)}&garment=${encodeURIComponent(garmentId)}`,
    )
      .then((result) => {
        if (live) setData(result);
      })
      .catch((error) => {
        if (live)
          setMessage(
            error.code === "no_chart"
              ? "No matching size chart. Ask a manager to add this product’s brand and clothing chart."
              : "Size guidance is unavailable. You can continue trying clothes and saving looks.",
          );
      });
    return () => {
      live = false;
    };
  }, [customerId, garmentId]);
  return (
    <aside className="size-guidance" aria-label="Size guidance">
      {data?.size ? (
        <details>
          <summary>
            Suggested {data.size} · {data.confidence}
          </summary>
          <p>{data.reason}</p>
          {data.alternatives.length > 0 && (
            <p>Also compare: {data.alternatives.map((a) => a.size).join(", ")}.</p>
          )}
        </details>
      ) : (
        <p>{data?.reason || message}</p>
      )}
    </aside>
  );
}
