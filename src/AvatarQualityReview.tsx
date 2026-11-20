import { useId, useState } from "react";
import { assessMasterAvatarReview, AVATAR_REVIEW_CRITERIA } from "./avatar-quality-gates.js";

const labels: Record<string, string> = {
  faceLikeness: "Face and hair resemble the customer",
  skinToneConsistency: "Skin tone is consistent across the body",
  bodyProportions: "Body proportions match the reference",
  neckBlend: "Face, neck and collar blend naturally",
  handsAndFeet: "Hands and feet appear anatomically plausible",
  fullBodyFraming: "Full body is visible, from head to feet",
};

export default function AvatarQualityReview({
  disabled = false,
  onCompleteChange,
}: {
  disabled?: boolean;
  onCompleteChange: (complete: boolean) => void;
}) {
  const id = useId();
  const [scores, setScores] = useState<Record<string, number>>({});
  const [customerConsent, setCustomerConsent] = useState(false);
  const [reviewerConfirmed, setReviewerConfirmed] = useState(false);
  const [completed, setCompleted] = useState(false);
  const result = assessMasterAvatarReview({ scores, customerConsent, reviewerConfirmed });
  const unscored = AVATAR_REVIEW_CRITERIA.filter((criterion) => !scores[criterion]).length;
  const belowThreshold = AVATAR_REVIEW_CRITERIA.filter(
    (criterion) => scores[criterion] && scores[criterion] < 4,
  ).length;

  function invalidateReview() {
    setCompleted(false);
    onCompleteChange(false);
  }

  return (
    <fieldset className="avatar-quality-review" disabled={disabled}>
      <legend>Personalized avatar quality review</legend>
      <p className="small-footnote">
        Compare with the customer or their consented reference photos. Score each item from 1
        (poor) to 5 (excellent). All six need at least 4. This is a human review, not automated
        identity verification. If you cannot verify an item, leave it unscored.
      </p>
      <div className="avatar-quality-grid">
        {AVATAR_REVIEW_CRITERIA.map((criterion) => (
          <label className="avatar-quality-row" key={criterion} htmlFor={id + criterion}>
            <span>{labels[criterion]}</span>
            <select
              id={id + criterion}
              value={scores[criterion] ?? 0}
              onChange={(event) => {
                setScores((previous) => ({
                  ...previous,
                  [criterion]: Number(event.target.value),
                }));
                invalidateReview();
              }}
            >
              <option value={0}>Not reviewed</option>
              <option value={1}>1 — Poor</option>
              <option value={2}>2 — Needs changes</option>
              <option value={3}>3 — Incomplete</option>
              <option value={4}>4 — Good</option>
              <option value={5}>5 — Excellent</option>
            </select>
          </label>
        ))}
      </div>
      <label className="consent">
        <input
          type="checkbox"
          checked={customerConsent}
          onChange={(event) => {
            setCustomerConsent(event.target.checked);
            invalidateReview();
          }}
        />
        <span>The customer authorizes review and reuse of this personalized avatar.</span>
      </label>
      <label className="consent">
        <input
          type="checkbox"
          checked={reviewerConfirmed}
          onChange={(event) => {
            setReviewerConfirmed(event.target.checked);
            invalidateReview();
          }}
        />
        <span>I compared the result against the customer or reference photographs.</span>
      </label>
      <button
        type="button"
        className="button secondary full-width"
        disabled={!result.approved || completed}
        onClick={() => {
          setCompleted(true);
          onCompleteChange(true);
        }}
      >
        {completed ? "Quality review passed" : "Confirm quality review"}
      </button>
      <p className="small-footnote" role="status" aria-live="polite">
        {completed
          ? "Quality review passed. Customer approval is now available below."
          : unscored > 0
            ? `${unscored} of 6 checks still need a score.`
            : belowThreshold > 0
              ? `${belowThreshold} checks are below 4. Correct the avatar before approval.`
              : result.approved
                ? "All criteria meet the threshold. Confirm the quality review."
                : "Confirm customer permission and that you compared the result."}
      </p>
    </fieldset>
  );
}
