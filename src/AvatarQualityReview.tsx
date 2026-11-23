import { useEffect, useId, useRef, useState } from "react";
import AvatarReferenceCompare from "./AvatarReferenceCompare";
import type { AvatarReviewAttestation } from "./account-avatars";
import {
  inspectAvatarGeometry,
  inspectAvatarTone,
  type AvatarGeometryAudit,
  type AvatarToneAudit,
} from "./body-pose";
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
  image,
  profileId,
  facePhoto,
  bodyPhoto,
  customHairstyle = false,
  onCompleteChange,
}: {
  disabled?: boolean;
  image: string;
  profileId: string;
  facePhoto: string | null;
  bodyPhoto: string | null;
  customHairstyle?: boolean;
  onCompleteChange: (complete: boolean, review?: AvatarReviewAttestation) => void;
}) {
  const id = useId();
  const [scores, setScores] = useState<Record<string, number>>({});
  const [customerConsent, setCustomerConsent] = useState(false);
  const [reviewerConfirmed, setReviewerConfirmed] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [geometry, setGeometry] = useState<AvatarGeometryAudit | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const inspectionEpoch = useRef(0);
  const [tone, setTone] = useState<AvatarToneAudit | null>(null);
  const [toneInspecting, setToneInspecting] = useState(false);
  const toneEpoch = useRef(0);
  useEffect(() => {
    inspectionEpoch.current++;
    toneEpoch.current++;
    setGeometry(null);
    setTone(null);
    setInspecting(false);
    setToneInspecting(false);
    return () => {
      inspectionEpoch.current++;
      toneEpoch.current++;
    };
  }, [image, profileId]);

  async function inspectGeometry() {
    const current = ++inspectionEpoch.current;
    setInspecting(true);
    setGeometry(null);
    const result = await inspectAvatarGeometry(image, profileId);
    if (inspectionEpoch.current !== current) return;
    setGeometry(result);
    setInspecting(false);
  }
  async function inspectTone() {
    const current = ++toneEpoch.current;
    setToneInspecting(true);
    setTone(null);
    const result = await inspectAvatarTone(image);
    if (toneEpoch.current !== current) return;
    setTone(result);
    setToneInspecting(false);
  }

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
        Compare with the customer or their consented reference photos. Score each item from 1 (poor)
        to 5 (excellent). All six need at least 4. This is a human review, not automated identity
        verification. If you cannot verify an item, leave it unscored.
      </p>
      <AvatarReferenceCompare avatar={image} facePhoto={facePhoto} bodyPhoto={bodyPhoto} />
      <section className="avatar-geometry-audit" aria-label="Local avatar geometry check">
        <strong>Optional local framing and body-shape check</strong>
        <p className="small-footnote">
          Check the generated head-to-toe pose and approximate shoulder, waist and hip silhouette
          against the selected frame. The analysis stays on this device and uses no extra AI credit.
          It is advisory, cannot establish exact measurements, and does not replace your review.
        </p>
        <button
          type="button"
          className="button secondary full-width"
          disabled={inspecting || disabled}
          onClick={() => void inspectGeometry()}
        >
          {inspecting ? "Checking avatar framing…" : "Check framing and body proportions"}
        </button>
        {geometry && (
          <div className="avatar-geometry-results">
            <p className="small-footnote">
              {geometry.status === "clear"
                ? "No obvious pose or silhouette concerns were found. Still inspect the image carefully."
                : geometry.status === "unverified"
                  ? "The local check was unavailable. Complete the visual review manually."
                  : "Review these possible issues before approving the avatar:"}
            </p>
            {geometry.findings.length > 0 && (
              <ul>
                {geometry.findings.map((finding) => (
                  <li key={finding.code}>{finding.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
      <section className="avatar-geometry-audit" aria-label="Local avatar skin-tone check">
        <strong>Optional generated skin-tone consistency check</strong>
        <p className="small-footnote">
          Compare small colour samples from the generated face, neck and forearms. This stays on
          your device and uses no extra AI credits. Clothing, makeup, shadows and lighting can cause
          misleading differences; this does not verify the customer's natural complexion.
        </p>
        <button
          type="button"
          className="button secondary full-width"
          disabled={toneInspecting || disabled}
          onClick={() => void inspectTone()}
        >
          {toneInspecting ? "Checking colour consistency…" : "Check skin-tone consistency"}
        </button>
        {tone && (
          <div className="avatar-geometry-results" role="status" aria-live="polite">
            <p className="small-footnote">
              {tone.status === "clear"
                ? "No large difference was found among sampled regions. Still compare the avatar with the customer."
                : tone.status === "unverified"
                  ? "The samples could not be checked reliably. Review the face, neck and exposed skin manually."
                  : "Review the following possible colour or coverage differences:"}
            </p>
            {tone.findings.length > 0 && (
              <ul>
                {tone.findings.map((finding) => (
                  <li key={finding.code}>{finding.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
      <div className="avatar-quality-grid">
        {AVATAR_REVIEW_CRITERIA.map((criterion) => (
          <label className="avatar-quality-row" key={criterion} htmlFor={id + criterion}>
            <span>
              {criterion === "faceLikeness" && customHairstyle
                ? "Face resembles the customer and hair matches the requested style"
                : labels[criterion]}
            </span>
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
          onCompleteChange(true, {
            scores: { ...scores },
            customerConsent,
            reviewerConfirmed,
          });
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
