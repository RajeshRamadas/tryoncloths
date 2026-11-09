import { ratingKey, validateJewelleryReview, identityStatistics } from "./jewellery-review-data.js";

const report = window.jewelleryEvaluationData;
const $ = (id) => document.getElementById(id);
const draft = new Map();
let cursor = 0;
const entries = report.cases.flatMap((c) =>
  c.results.map((result) => ({
    ...c,
    result,
    key: ratingKey(c.itemId, c.portraitId, result.providerId),
  })),
);
const element = (tag, text, parent) => {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (parent) parent.append(el);
  return el;
};
const choices = (control, rows) => {
  for (const [value, label] of rows) {
    const option = element("option", label, control);
    option.value = value;
  }
};
choices(
  $("provider"),
  report.providers.map((p) => [p.id, `${p.label} · ${p.evidence} · ${p.mode}`]),
);
choices(
  $("item"),
  report.items.map((p) => [p.id, p.name]),
);
choices(
  $("portrait"),
  report.portraits.map((p) => [p.id, p.id]),
);
$("threshold").value = report.identityThreshold;
$("collection").textContent =
  `Collection: ${report.collection}. Operator supplied. Accepted-only outputs cannot measure identity false rejects for release.`;
function validRatings() {
  const valid = [];
  for (const row of draft.values()) {
    try {
      validateJewelleryReview(report, {
        version: 1,
        kind: "jewellery-review",
        reportId: report.reportId,
        ratings: [row],
      });
      valid.push(row);
    } catch {
      /* Incomplete drafts stay in memory only. */
    }
  }
  return valid;
}
function filtered() {
  const complete = new Set(
    validRatings().map((r) => ratingKey(r.itemId, r.portraitId, r.providerId)),
  );
  return entries.filter(
    (e) =>
      (!$("provider").value || e.result.providerId === $("provider").value) &&
      (!$("item").value || e.itemId === $("item").value) &&
      (!$("portrait").value || e.portraitId === $("portrait").value) &&
      ($("pending").value === "all" ||
        ($("pending").value === "reviewed"
          ? complete.has(e.key)
          : e.result.status === "review_required" && !complete.has(e.key))),
  );
}
function updateStatus() {
  const ratings = validRatings(),
    scoreable = entries.filter((e) => e.result.status === "review_required").length;
  $("status").textContent =
    `${ratings.length} of ${scoreable} reviewable outputs completed. ${entries.length - scoreable} failed or not run. Incomplete scores are omitted from downloads.`;
  const selected = entries.filter(
    (e) => !$("provider").value || e.result.providerId === $("provider").value,
  );
  const scores = new Map(ratings.map((r) => [ratingKey(r.itemId, r.portraitId, r.providerId), r]));
  const stats = identityStatistics(
    selected.map((e) => ({
      identityDistance: e.result.identityDistance,
      samePerson: scores.get(e.key)?.samePerson,
    })),
    Number($("threshold").value),
  );
  const percent = (value) => (value === null ? "unknown" : (value * 100).toFixed(1) + "%");
  $("threshold-value").textContent = Number($("threshold").value).toFixed(2);
  $("identity-summary").textContent =
    `${stats.measured} distances, ${stats.unavailable} unavailable; ${stats.same.count} human-same and ${stats.different.count} human-different pairs. False rejects: ${percent(stats.falseRejectRate)}. False accepts: ${percent(stats.falseAcceptRate)}. ${stats.calibrationMeasured ? "At least 50 same-person pairs recorded." : "Fewer than 50 same-person pairs; calibration evidence incomplete."} Server threshold unchanged.`;
}
function showImage(parent, src, label) {
  const figure = element("figure", "", parent),
    img = element("img", "", figure);
  img.src = src;
  img.alt = label;
  element("figcaption", label, figure);
}
function render() {
  const list = filtered();
  cursor = Math.max(0, Math.min(cursor, list.length - 1));
  $("position").textContent = list.length
    ? `${cursor + 1} / ${list.length}`
    : "No matching outputs";
  $("previous").disabled = !list.length || cursor === 0;
  $("next").disabled = !list.length || cursor === list.length - 1;
  const area = $("case");
  area.replaceChildren();
  updateStatus();
  if (!list.length) {
    element("p", "No outputs match these filters.", area);
    return;
  }
  const entry = list[cursor],
    result = entry.result;
  const item = report.items.find((i) => i.id === entry.itemId),
    portrait = report.portraits.find((p) => p.id === entry.portraitId),
    provider = report.providers.find((p) => p.id === result.providerId);
  element("h2", `${item.name} · ${portrait.id}`, area);
  element(
    "p",
    `${provider.label} · ${provider.model} · ${provider.evidence} evidence · ${provider.mode}`,
    area,
  ).className = "badge";
  const images = element("div", "", area);
  images.className = "images";
  showImage(images, item.image, "Requested jewellery");
  showImage(images, portrait.image, "Customer portrait");
  if (result.image) showImage(images, result.image, "Provider output");
  else element("p", "No output image: " + (result.failureCode || result.status), images);
  element(
    "p",
    `Status: ${result.status}. Identity: ${result.identityCheck || "not checked"}; distance ${Number.isFinite(result.identityDistance) ? result.identityDistance.toFixed(4) : "unavailable"}. ${result.duplicateOutput ? "Repeated output detected; this run cannot qualify as a complete matrix." : ""}`,
    area,
  ).className = "metadata";
  if (result.status !== "review_required") {
    element(
      "p",
      "This outcome cannot be scored. Failed and missing outputs remain in the summary.",
      area,
    );
    return;
  }
  const row = draft.get(entry.key) || {
    itemId: entry.itemId,
    portraitId: entry.portraitId,
    providerId: result.providerId,
    reviewerId: $("reviewer").value,
    scores: {},
    samePerson: "",
    notes: "",
  };
  const save = () => {
    row.reviewerId = $("reviewer").value;
    draft.set(entry.key, row);
    updateStatus();
    if ($("pending").value !== "all" && !filtered().some((e) => e.key === entry.key)) render();
  };
  const scores = element("div", "", area);
  scores.className = "scores";
  for (const [key, name] of Object.entries(report.rubric)) {
    const label = element("label", name, scores),
      select = element("select", "", label);
    select.dataset.score = key;
    select.setAttribute("aria-label", name);
    choices(select, [
      ["", "Choose a score"],
      ["1", "1 · Unusable"],
      ["2", "2 · Major issues"],
      ["3", "3 · Needs improvement"],
      ["4", "4 · Good"],
      ["5", "5 · Excellent"],
    ]);
    select.value = row.scores[key] || "";
    select.addEventListener("change", () => {
      row.scores[key] = Number(select.value);
      save();
    });
  }
  const label = element("label", "Is this the same customer?", area),
    same = element("select", "", label);
  same.setAttribute("aria-label", "Is this the same customer?");
  choices(same, [
    ["", "Choose an identity label"],
    ["same", "Same person"],
    ["different", "Different person"],
    ["unsure", "Unsure"],
  ]);
  same.value = row.samePerson;
  same.addEventListener("change", () => {
    row.samePerson = same.value;
    save();
  });
  const notesLabel = element("label", "Review notes (no personal details)", area),
    notes = element("textarea", "", notesLabel);
  notes.maxLength = 2000;
  notes.value = row.notes;
  notes.addEventListener("input", () => {
    row.notes = notes.value;
    save();
  });
  if (row.reviewerId && row.reviewerId !== $("reviewer").value)
    element(
      "p",
      `Saved reviewer: ${row.reviewerId}. Editing assigns your current reviewer ID.`,
      area,
    );
}
for (const id of ["provider", "item", "portrait", "pending"])
  $(id).addEventListener("change", () => {
    cursor = 0;
    render();
  });
$("previous").addEventListener("click", () => {
  cursor--;
  render();
});
$("next").addEventListener("click", () => {
  cursor++;
  render();
});
$("threshold").addEventListener("input", updateStatus);
$("reviewer").addEventListener("input", () => {
  const entry = filtered()[cursor];
  if (entry && draft.has(entry.key)) draft.get(entry.key).reviewerId = $("reviewer").value;
  updateStatus();
});
$("export").addEventListener("click", () => {
  const review = {
    version: 1,
    kind: "jewellery-review",
    reportId: report.reportId,
    ratings: validRatings(),
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(review, null, 2)], { type: "application/json" }),
  );
  const link = element("a");
  link.href = url;
  link.download = "jewellery-review.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("import").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error();
    const imported = validateJewelleryReview(report, JSON.parse(await file.text()));
    draft.clear();
    for (const [key, row] of imported) draft.set(key, row);
    $("error").textContent = "";
    cursor = 0;
    render();
  } catch {
    $("error").textContent =
      "Cannot load this review. Use complete scores exported for this exact report. Your current scores were kept.";
  }
  event.target.value = "";
});
render();
