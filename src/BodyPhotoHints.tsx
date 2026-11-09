import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { checkBodyPhoto, type PoseHint } from "./body-pose";

/** Advisory pose and framing hints for the customer's full-body photo, computed on the device. */
export default function BodyPhotoHints({ photo }: { photo: string }) {
  const [state, setState] = useState<{ photo: string; hints: PoseHint[] | null } | null>(null);
  useEffect(() => {
    let current = true;
    void checkBodyPhoto(photo).then((hints) => {
      if (current) setState({ photo, hints });
    });
    return () => {
      current = false;
    };
  }, [photo]);
  const done = state?.photo === photo;
  if (done && state.hints === null) return null;
  return (
    <div className="pose-hints" role="status" aria-label="Full-body photo check">
      {!done ? (
        <p>
          <LoaderCircle className="spin" size={14} /> Checking pose on this device…
        </p>
      ) : state.hints!.length ? (
        <>
          <p>
            <CircleAlert size={14} /> Photo check: a retake may give a better avatar.
          </p>
          <ul>
            {state.hints!.map((h) => (
              <li key={h.code}>{h.message}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="pose-ok">
          <CircleCheck size={14} /> Pose looks good: head to toe, facing the camera.
        </p>
      )}
    </div>
  );
}
