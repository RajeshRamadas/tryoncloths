import { useEffect, useState } from "react";
import { requestApi } from "./api";
import { garmentChoices } from "./garment-types";
import { sizeApi, type SizeChart } from "./size-api";
import { downloadText, reportCsv, type ImportReport } from "./catalogue";
const categories = garmentChoices.filter(([key]) => key !== "shoes");
export default function SizeCharts() {
  const [role, setRole] = useState(""),
    [rows, setRows] = useState<SizeChart[]>([]),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [filterBrand, setFilterBrand] = useState(""),
    [filterType, setFilterType] = useState("all");
  const [editing, setEditing] = useState<string | null>(null),
    [brand, setBrand] = useState(""),
    [type, setType] = useState("shirt"),
    [size, setSize] = useState(""),
    [chest, setChest] = useState(""),
    [waist, setWaist] = useState(""),
    [hip, setHip] = useState(""),
    [sort, setSort] = useState("0");
  const [file, setFile] = useState<File | null>(null),
    [report, setReport] = useState<ImportReport | null>(null);
  const manager = role === "owner" || role === "manager";
  async function load(page = 0) {
    const result = await sizeApi(
      "/api/size-charts?" +
        new URLSearchParams({ brand: filterBrand, type: filterType, offset: String(page) }),
    );
    setRows(result.charts);
    setTotal(result.total);
    setOffset(result.offset);
  }
  useEffect(() => {
    let live = true;
    void sizeApi("/api/account")
      .then(async (result) => {
        if (!live) return;
        setRole(result.account?.user?.role || "");
        await load();
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(row: SizeChart) {
    setEditing(row.id);
    setBrand(row.brand);
    setType(row.garmentType);
    setSize(row.size);
    setChest(row.measurements.chestCm == null ? "" : String(row.measurements.chestCm));
    setWaist(row.measurements.waistCm == null ? "" : String(row.measurements.waistCm));
    setHip(row.measurements.hipCm == null ? "" : String(row.measurements.hipCm));
    setSort(String(row.sortOrder));
  }
  function clear() {
    setEditing(null);
    setSize("");
    setChest("");
    setWaist("");
    setHip("");
    setSort("0");
  }
  async function save() {
    await sizeApi("/api/size-charts" + (editing ? "/" + editing : ""), editing ? "PATCH" : "POST", {
      brand,
      garmentType: type,
      size,
      sortOrder: Number(sort),
      measurements: {
        chestCm: chest ? Number(chest) : null,
        waistCm: waist ? Number(waist) : null,
        hipCm: hip ? Number(hip) : null,
      },
    });
    clear();
    await load();
    setNotice("Size chart row saved.");
  }
  async function upload() {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) throw new Error("Choose a chart CSV up to 5 MB.");
    const form = new FormData();
    form.append("file", file);
    const response = await requestApi(
        "/api/size-charts/import",
        { method: "POST", body: form },
        60000,
      ),
      result = await response.json();
    if (!response.ok) throw new Error(result.error || "Import failed.");
    setReport(result);
    await load();
  }
  return (
    <main className="billing-page size-charts-page">
      <a href="/">Back to Forme</a>
      <h1>Size charts</h1>
      <p>
        Enter chart targets in centimetres for the exact product brand and clothing type. Guidance
        uses no AI credits and does not guarantee fit.
      </p>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {manager && (
        <>
          <section>
            <h2>{editing ? "Edit chart row" : "Add chart row"}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(save);
              }}
            >
              <label>
                Chart brand
                <input
                  value={brand}
                  maxLength={80}
                  required
                  disabled={busy}
                  onChange={(e) => setBrand(e.target.value)}
                />
              </label>
              <label>
                Chart clothing type
                <select value={type} disabled={busy} onChange={(e) => setType(e.target.value)}>
                  {categories.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Chart size label
                <input
                  value={size}
                  maxLength={30}
                  required
                  disabled={busy}
                  onChange={(e) => setSize(e.target.value)}
                />
              </label>
              <div className="measurement-grid">
                <label>
                  Chart chest (cm)
                  <input
                    type="number"
                    step="any"
                    min="60"
                    max="200"
                    value={chest}
                    disabled={busy}
                    onChange={(e) => setChest(e.target.value)}
                  />
                </label>
                <label>
                  Chart waist (cm)
                  <input
                    type="number"
                    step="any"
                    min="40"
                    max="220"
                    value={waist}
                    disabled={busy}
                    onChange={(e) => setWaist(e.target.value)}
                  />
                </label>
                <label>
                  Chart hip (cm)
                  <input
                    type="number"
                    step="any"
                    min="50"
                    max="240"
                    value={hip}
                    disabled={busy}
                    onChange={(e) => setHip(e.target.value)}
                  />
                </label>
              </div>
              <label>
                Chart sort order
                <input
                  type="number"
                  min="0"
                  max="10000"
                  value={sort}
                  disabled={busy}
                  onChange={(e) => setSort(e.target.value)}
                />
              </label>
              <p>
                Provide at least one target. Use the same measurement fields for all sizes in a
                range. Enter circumferences, not flat widths; footwear sizing is not supported here.
              </p>
              <button className="button primary" disabled={busy}>
                Save chart row
              </button>
              {editing && (
                <button className="button secondary" disabled={busy} type="button" onClick={clear}>
                  Cancel chart edit
                </button>
              )}
            </form>
          </section>
          <section>
            <h2>Import chart CSV</h2>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const response = await requestApi("/api/size-charts/template.csv");
                  if (!response.ok) throw new Error("Template could not be downloaded.");
                  downloadText("size-chart-template.csv", await response.text());
                })
              }
            >
              Download size chart template
            </button>
            <label>
              Size chart CSV
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  setReport(null);
                }}
              />
            </label>
            <button
              className="button secondary"
              disabled={busy || !file}
              onClick={() => void action(upload)}
            >
              Import size charts
            </button>
            {report && (
              <div role="status">
                <p>
                  {report.created} created · {report.updated} updated · {report.skipped} skipped
                </p>
                {report.errors.length > 0 && (
                  <button
                    className="button secondary"
                    onClick={() => downloadText("size-chart-errors.csv", reportCsv(report))}
                  >
                    Download size chart errors
                  </button>
                )}
              </div>
            )}
          </section>
          <section>
            <h2>Saved chart rows</h2>
            <form
              className="catalogue-filters"
              onSubmit={(e) => {
                e.preventDefault();
                void action(() => load());
              }}
            >
              <label>
                Filter chart brand
                <input
                  value={filterBrand}
                  maxLength={80}
                  placeholder="Exact brand label"
                  disabled={busy}
                  onChange={(e) => setFilterBrand(e.target.value)}
                />
              </label>
              <label>
                Filter chart type
                <select
                  value={filterType}
                  disabled={busy}
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="all">All clothing types</option>
                  {categories.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button secondary" disabled={busy}>
                Apply chart filters
              </button>
            </form>
            <p>{total} chart rows</p>
            {rows.map((row) => (
              <article className="size-chart-row" key={row.id}>
                <h3>
                  {row.brand} · {row.garmentType} · {row.size}
                </h3>
                <p>
                  {Object.entries(row.measurements)
                    .map(([key, value]) => `${key.replace("Cm", "")}: ${value} cm`)
                    .join(" · ")}{" "}
                  · order {row.sortOrder}
                </p>
                <button className="button secondary" disabled={busy} onClick={() => edit(row)}>
                  Edit {row.brand} {row.size}
                </button>
                <button
                  className="button back-button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await sizeApi("/api/size-charts/" + row.id, "DELETE");
                      if (editing === row.id) clear();
                      await load(offset);
                    })
                  }
                >
                  Delete {row.brand} {row.size}
                </button>
              </article>
            ))}
            <div className="customer-actions">
              <button
                className="button secondary"
                disabled={busy || offset === 0}
                onClick={() => void action(() => load(Math.max(0, offset - 100)))}
              >
                Previous chart rows
              </button>
              <button
                className="button secondary"
                disabled={busy || offset + 100 >= total}
                onClick={() => void action(() => load(offset + 100))}
              >
                Next chart rows
              </button>
            </div>
          </section>
        </>
      )}
      {busy && <p role="status">Updating size charts…</p>}
    </main>
  );
}
