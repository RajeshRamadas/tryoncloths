import { requestApi } from "./api";
import type { StoreGarment } from "./store-garments";
export type CataloguePage = {
  garments: StoreGarment[];
  total: number;
  offset: number;
  limit: number;
  capacity: number;
  stored: number;
};
export type ImportReport = {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
};
export async function catalogueApi(path: string, init?: RequestInit, timeout = 30000) {
  const response = await requestApi(path, init, timeout),
    data = await response.json();
  if (response.status === 401) window.dispatchEvent(new Event("forme-account-expired"));
  if (!response.ok) throw new Error(data.error || "Catalogue request failed.");
  return data;
}
export async function browseCatalogue(
  filters: { search?: string; type?: string; stock?: string; offset?: number; limit?: number } = {},
): Promise<CataloguePage> {
  const query = new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, String(v)]));
  return catalogueApi("/api/catalogue?" + query);
}
export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
export function reportCsv(report: ImportReport) {
  const cell = (value: unknown) => {
    let s = String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    "row,message\r\n" +
    report.errors.map((e) => [e.row, e.message].map(cell).join(",")).join("\r\n")
  );
}
export async function spreadsheetCsv(file: File): Promise<File> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Choose a CSV or Excel file up to 5 MB.");
  if (/\.csv$/i.test(file.name)) return file;
  if (!/\.xlsx?$/i.test(file.name)) throw new Error("Choose a CSV, XLSX or XLS file.");
  const buffer = await file.arrayBuffer(),
    worker = new Worker(new URL("./spreadsheet-worker.ts", import.meta.url), { type: "module" });
  try {
    const csv = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error("Spreadsheet conversion took too long. Export a smaller UTF-8 CSV instead."),
          ),
        20000,
      );
      worker.onmessage = (e) => {
        clearTimeout(timer);
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(e.data.csv);
      };
      worker.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Spreadsheet could not be read. Export a UTF-8 CSV instead."));
      };
      worker.postMessage(buffer, [buffer]);
    });
    const result = new File([csv], file.name.replace(/\.xlsx?$/i, ".csv"), { type: "text/csv" });
    if (result.size > 5 * 1024 * 1024)
      throw new Error("Converted CSV exceeds 5 MB. Split the spreadsheet before importing.");
    return result;
  } finally {
    worker.terminate();
  }
}
