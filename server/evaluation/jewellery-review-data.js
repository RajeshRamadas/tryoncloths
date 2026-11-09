// Shared by the private review page and the offline summary; no networking or storage.
export const ratingKey = (itemId, portraitId, providerId) =>
  [itemId, portraitId, providerId].join("/");
const id = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,60}$/.test(v);
export function validateJewelleryReview(report, review) {
  if (
    review?.version !== 1 ||
    review.kind !== "jewellery-review" ||
    review.reportId !== report.reportId ||
    !Array.isArray(review.ratings) ||
    review.ratings.length > 1200
  )
    throw new Error("Choose ratings exported for this exact jewellery report.");
  const answers = new Map();
  for (const r of review.ratings) {
    const c = report.cases.find((c) => c.itemId === r.itemId && c.portraitId === r.portraitId),
      result = c?.results.find((p) => p.providerId === r.providerId),
      key = ratingKey(r.itemId, r.portraitId, r.providerId);
    if (
      !result ||
      result.status !== "review_required" ||
      answers.has(key) ||
      !id(r.reviewerId) ||
      !["same", "different", "unsure"].includes(r.samePerson) ||
      typeof r.notes !== "string" ||
      r.notes.length > 2000 ||
      !r.scores ||
      Object.keys(r.scores).some((k) => !Object.hasOwn(report.rubric, k)) ||
      Object.keys(report.rubric).some(
        (k) => !Number.isInteger(r.scores[k]) || r.scores[k] < 1 || r.scores[k] > 5,
      ) ||
      (r.samePerson === "different" && r.scores.identity >= 4)
    )
      throw new Error(
        "Complete each unique review with a reviewer ID, three scores, identity label and bounded notes.",
      );
    answers.set(key, {
      itemId: r.itemId,
      portraitId: r.portraitId,
      providerId: r.providerId,
      reviewerId: r.reviewerId,
      scores: Object.fromEntries(Object.keys(report.rubric).map((k) => [k, r.scores[k]])),
      samePerson: r.samePerson,
      notes: r.notes,
    });
  }
  return answers;
}
export function identityStatistics(rows, threshold) {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1)
    throw new Error("Use an identity threshold above 0 and at most 1.");
  const quantiles = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    // Linear interpolation (R-7), including the mean of the middle two
    // observations for an even-sized median. Empty samples stay unknown.
    const at = (q) => {
      if (!sorted.length) return null;
      const position = (sorted.length - 1) * q,
        index = Math.floor(position);
      return (
        sorted[index] +
        (sorted[Math.min(index + 1, sorted.length - 1)] - sorted[index]) * (position - index)
      );
    };
    return {
      count: sorted.length,
      min: sorted[0] ?? null,
      p05: at(0.05),
      median: at(0.5),
      p95: at(0.95),
      p99: at(0.99),
      max: sorted.at(-1) ?? null,
    };
  };
  const usable = rows.filter(
    (r) =>
      Number.isFinite(r.identityDistance) && r.identityDistance >= 0 && r.identityDistance <= 100,
  );
  const same = usable.filter((r) => r.samePerson === "same"),
    different = usable.filter((r) => r.samePerson === "different");
  const falseRejects = same.filter((r) => r.identityDistance > threshold).length;
  const falseAccepts = different.filter((r) => r.identityDistance <= threshold).length;
  return {
    threshold,
    measured: usable.length,
    unavailable: rows.length - usable.length,
    same: quantiles(same.map((r) => r.identityDistance)),
    different: quantiles(different.map((r) => r.identityDistance)),
    unlabelled: usable.filter((r) => !r.samePerson || r.samePerson === "unsure").length,
    falseRejects,
    falseAccepts,
    falseRejectRate: same.length ? falseRejects / same.length : null,
    falseAcceptRate: different.length ? falseAccepts / different.length : null,
    calibrationMeasured: same.length >= 50,
    thresholdChanged: false,
  };
}
