import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { checkPhotoClarity, type PhotoClarityAssessment } from "./photo-clarity-browser";

/** No pixels or source photo are retained by this UI's assessment state. */
export default function PhotoClarityHints({
  photo,
  kind,
}: {
  photo: string;
  kind: "face" | "body";
}) {
  const [state, setState] = useState<PhotoClarityAssessment | null>(null);
  useEffect(() => {
    let current = true;
    setState(null);
    void checkPhotoClarity(photo).then((result) => {
      if (current) setState(result);
    });
    return () => {
      current = false;
    };
  }, [photo]);
  const title = kind === "face" ? "Face photo" : "Full-body photo";
  const findings = state ? [...state.issues, ...state.warnings] : [];
  return (
    <div className="pose-hints" role="status" aria-label={`${title} clarity check`}>
      {!state ? (
        <p>
          <LoaderCircle className="spin" size={14} /> Checking {title.toLowerCase()} clarity on
          this device…
        </p>
      ) : state.status === "clear" ? (
        <p className="pose-ok">
          <CircleCheck size={14} /> {title} has no obvious exposure or softness warnings.
          Check likeness and detail yourself.
        </p>
      ) : (
        <>
          <p>
            <CircleAlert size={14} />
            {state.status === "blocked"
              ? ` ${title} is not usable for generation. Retake it first.`
              : ` ${title} may benefit from a retake.`}
          </p>
          <ul>
            {findings.map((finding) => (
              <li key={finding.code}>{finding.message}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
