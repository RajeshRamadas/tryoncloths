import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { checkFacePhoto } from "./face-photo";

export default function FacePhotoHints({ photo }: { photo: string }) {
  const [state, setState] = useState<{ photo: string; hints: string[] | null } | null>(null);
  useEffect(() => {
    let current = true;
    void checkFacePhoto(photo).then((hints) => {
      if (current) setState({ photo, hints });
    });
    return () => {
      current = false;
    };
  }, [photo]);
  const hints = state?.photo === photo ? state.hints : undefined;

  return (
    <div className="pose-hints" role="status" aria-label="Face photo framing check">
      {hints === undefined ? (
        <p>
          <LoaderCircle className="spin" size={14} /> Checking face framing on this device…
        </p>
      ) : hints === null ? (
        <p>
          <CircleAlert size={14} /> Face framing couldn’t be checked. Make sure the customer is
          alone and their whole face is visible.
        </p>
      ) : hints.length ? (
        <>
          <p>
            <CircleAlert size={14} /> Check the face photo before continuing.
          </p>
          <ul>
            {hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="pose-ok">
          <CircleCheck size={14} /> One face detected with space around it. Check that the
          customer’s features are clear.
        </p>
      )}
    </div>
  );
}
