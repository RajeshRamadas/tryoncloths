import { requestApi } from "./api";
export type SizeSuggestionData = {
  size: string | null;
  confidence: "High" | "Medium" | "Low";
  reason: string;
  alternatives: { size: string; score: number }[];
  source: string;
};
export type SizeChart = {
  id: string;
  brand: string;
  garmentType: string;
  size: string;
  measurements: { chestCm?: number; waistCm?: number; hipCm?: number };
  sortOrder: number;
};
export async function sizeApi(path: string, method = "GET", body?: unknown) {
  const response = await requestApi(
      path,
      {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      },
      30000,
    ),
    data = await response.json();
  if (response.status === 401) window.dispatchEvent(new Event("forme-account-expired"));
  if (!response.ok)
    throw Object.assign(new Error(data.error || "Size information is unavailable."), {
      code: data.code,
    });
  return data;
}
