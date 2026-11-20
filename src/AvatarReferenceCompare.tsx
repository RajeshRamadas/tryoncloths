import { useState } from "react";
import { availableAvatarReferences } from "./avatar-reference-compare.js";

type ReviewMode = "face" | "body";

export default function AvatarReferenceCompare({
  avatar,
  facePhoto,
  bodyPhoto,
}: {
  avatar: string;
  facePhoto: string | null;
  bodyPhoto: string | null;
}) {
  const [mode, setMode] = useState<ReviewMode>("face");
  const [zoom, setZoom] = useState(2);
  const available = availableAvatarReferences({ facePhoto, bodyPhoto });
  const showingFace = mode === "face";
  const referenceAvailable = showingFace ? available.face : available.body;
  const reference = showingFace ? facePhoto : bodyPhoto;

  return (
    <section className="avatar-reference-compare" aria-label="Compare reference photos with avatar">
      <h3>Compare with customer references</h3>
      <p className="small-footnote">
        Inspect the face and full-body proportions side by side before giving quality scores.
        Display-only zoom does not change the generated avatar or measure likeness.
      </p>
      {(!available.face || !available.body) && (
        <p className="avatar-reference-warning">
          Original reference photos are not available for every view. Saved and imported avatars
          never restore the original photos. Compare with the customer or a separately consented
          reference before scoring; do not guess.
        </p>
      )}
      <div className="avatar-reference-switch" aria-label="Choose comparison view">
        <button
          type="button"
          className="button secondary"
          aria-pressed={showingFace}
          onClick={() => setMode("face")}
        >
          Face comparison
        </button>
        <button
          type="button"
          className="button secondary"
          aria-pressed={!showingFace}
          onClick={() => setMode("body")}
        >
          Full-body comparison
        </button>
      </div>
      {showingFace && (
        <label className="avatar-reference-zoom">
          <span>Generated face zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.25}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <span>{zoom.toFixed(2)}×</span>
        </label>
      )}
      <div className="avatar-reference-grid">
        <figure>
          <div className={showingFace ? "avatar-reference-image face" : "avatar-reference-image body"}>
            {referenceAvailable && reference ? (
              <img
                src={reference}
                alt={showingFace ? "Original customer face reference" : "Original customer full-body reference"}
                className={showingFace ? "avatar-reference-original-face" : ""}
                draggable={false}
              />
            ) : (
              <p className="avatar-reference-unavailable">
                {showingFace
                  ? "Original face photo unavailable. Compare the generated face with the customer in person."
                  : "Original full-body photo unavailable. Compare the generated figure with the customer in person."}
              </p>
            )}
          </div>
          <figcaption>{showingFace ? "Customer face reference" : "Customer body reference"}</figcaption>
        </figure>
        <figure>
          <div className={showingFace ? "avatar-reference-image face" : "avatar-reference-image body"}>
            <img
              src={avatar}
              alt={showingFace ? "Generated avatar face close-up" : "Generated avatar full-body comparison"}
              className={showingFace ? "avatar-reference-generated-face" : ""}
              style={showingFace ? { transform: `scale(${zoom})` } : undefined}
              draggable={false}
            />
          </div>
          <figcaption>{showingFace ? "Generated face detail" : "Generated full-body avatar"}</figcaption>
        </figure>
      </div>
      <p className="small-footnote">
        Photos shown here are used only for this on-screen comparison. The comparison itself
        does not upload, save, or score facial images.
      </p>
    </section>
  );
}
