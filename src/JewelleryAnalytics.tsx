export type JewelleryMetrics = {
  tryonsGenerated: number;
  tryonsReused: number;
  overlays: number;
  tryons: number;
  tryonSessions: number;
  comparisonsCompleted: number;
  comparisonsPartial: number;
  looksSaved: number;
  setsSaved: number;
  completeLooksSaved: number;
  looksShared: number;
  shareViews: number;
  purchases: number;
  conversion: number | null;
  untrackedProductTryons: number;
  unattributedPurchases: number;
};
export type JewelleryReport = {
  trackingSince: number;
  unclassifiedLookEvents: number;
  totals: JewelleryMetrics;
  days: (JewelleryMetrics & { date: string })[];
  stores: (JewelleryMetrics & { id: string; name: string })[];
  staff: (JewelleryMetrics & { id: string | null; storeId: string; name: string })[];
  products: (JewelleryMetrics & {
    id: string;
    storeId: string;
    name: string;
    sku: string | null;
  })[];
  productsTracked: number;
};
export default function JewelleryAnalytics({
  report,
  stores,
}: {
  report: JewelleryReport;
  stores: { id: string; name: string }[];
}) {
  const t = report.totals,
    storeName = (id: string) => stores.find((s) => s.id === id)?.name || "Store";
  const table = (title: string, rows: (JewelleryMetrics & { key: string; name: string })[]) => (
    <details>
      <summary>{title}</summary>
      <div className="analytics-table-scroll" role="region" aria-label={title} tabIndex={0}>
        <table className="jewellery-analytics-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">AI generated</th>
              <th scope="col">AI reused</th>
              <th scope="col">Free overlays</th>
              <th scope="col">Sessions</th>
              <th scope="col">Sets saved</th>
              <th scope="col">Completed comparisons</th>
              <th scope="col">Partial comparisons</th>
              <th scope="col">Purchased looks</th>
              <th scope="col">Share links</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.name}</th>
                <td>{r.tryonsGenerated}</td>
                <td>{r.tryonsReused}</td>
                <td>{r.overlays}</td>
                <td>{r.tryonSessions}</td>
                <td>{r.setsSaved}</td>
                <td>{r.comparisonsCompleted}</td>
                <td>{r.comparisonsPartial}</td>
                <td>{r.purchases}</td>
                <td>{r.looksShared}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p>No recorded jewellery activity in this period.</p>}
    </details>
  );
  return (
    <section aria-label="Jewellery activity">
      <h2>Jewellery activity</h2>
      <p>
        Recorded jewellery fittings, saved sets and purchase marks for the displayed dates and
        stores. AI reuse and free overlays are counted separately.
      </p>
      <div className="analytics-cards">
        {[
          ["Jewellery AI generated", t.tryonsGenerated],
          ["Jewellery AI reused", t.tryonsReused],
          ["Free jewellery overlays", t.overlays],
          ["Jewellery fitting sessions", t.tryonSessions],
          ["Jewellery sets saved", t.setsSaved],
          ["Completed jewellery comparisons", t.comparisonsCompleted],
          ["Partial jewellery comparisons", t.comparisonsPartial],
          ["Jewellery purchased looks", t.purchases],
          ["Jewellery share links", t.looksShared],
        ].map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{Number(value).toLocaleString("en-IN")}</strong>
          </article>
        ))}
      </div>
      <p>
        {t.tryons} jewellery fittings · {t.looksSaved} distinct jewellery looks saved, including{" "}
        {t.completeLooksSaved} complete-look boards · {t.shareViews} share page views.
      </p>
      <p className="analytics-note">
        A set is a saved jewellery look with at least two item entries; a complete-look board is
        counted separately. A completed comparison has two successful previews; a partial comparison
        has one. Each successful AI variant also counts as one fitting. Cost checks, placement
        preparation, reopening and failed fittings do not count.
      </p>
      <p className="analytics-note">
        Sessions group fitting actions for one avatar in an open studio visit. They do not measure
        every showroom visitor or unique person. Purchase marks are staff confirmations, not
        verified sales, units or revenue. Complete-look purchases count once; their jewellery
        product attribution excludes clothing.
      </p>
      {(t.untrackedProductTryons > 0 || t.unattributedPurchases > 0) && (
        <p>
          {t.untrackedProductTryons} jewellery fittings have no catalogue product ID.{" "}
          {t.unattributedPurchases} jewellery purchase marks have no fitting session in this period.
        </p>
      )}
      <p className="small-footnote">
        On a narrow screen, scroll tables sideways to see every column.
      </p>
      {table(
        "Jewellery daily activity (IST)",
        report.days.map((r) => ({ ...r, key: r.date, name: r.date })),
      )}
      {table(
        "Jewellery store performance",
        report.stores.map((r) => ({ ...r, key: r.id })),
      )}
      {table(
        "Jewellery staff performance",
        report.staff.map((r) => ({
          ...r,
          key: r.storeId + ":" + r.id,
          name: r.name + " · " + storeName(r.storeId),
        })),
      )}
      {table(
        `Jewellery product performance (${report.products.length} of ${report.productsTracked})`,
        report.products.map((r) => ({
          ...r,
          key: r.storeId + ":" + r.id,
          name: r.name + (r.sku ? " · " + r.sku : "") + " · " + storeName(r.storeId),
        })),
      )}
      <p className="analytics-note">
        Detailed jewellery tracking began{" "}
        {new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata" }).format(
          new Date(report.trackingSince),
        )}
        . Earlier AI fittings tagged as jewellery are included; {report.unclassifiedLookEvents}{" "}
        older look, share or purchase records have no category and are excluded from this section.
        No historical category is guessed from an edited or deleted item. Share views may include
        bots. CSV includes every tracked product; the screen shows up to 50.
      </p>
    </section>
  );
}
