import { useEffect, useState } from "react";
import { accountAvatarImage } from "./account-avatars";
import { profiles } from "./profiles";
import type { SavedAvatar } from "./saved-avatars";

const versionNumber = (avatar: SavedAvatar) => avatar.masterVersion ?? 1;

function VersionImage({ id, label, zoom }: { id: string; label: string; zoom: number }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let imageUrl: string | undefined;
    void accountAvatarImage(id, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        imageUrl = URL.createObjectURL(blob);
        setUrl(imageUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => {
      controller.abort();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [id, attempt]);

  return (
    <div className="master-comparison-image">
      {error ? (
        <div>
          <p role="alert">{label} could not load.</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setUrl("");
              setError(false);
              setAttempt((previous) => previous + 1);
            }}
          >
            Retry {label.toLowerCase()}
          </button>
        </div>
      ) : url ? (
        <img
          src={url}
          alt={`${label} avatar`}
          style={{ transform: `scale(${zoom / 100})` }}
          onError={() => setError(true)}
        />
      ) : (
        <p role="status">Loading {label.toLowerCase()}…</p>
      )}
    </div>
  );
}

type Props = {
  versions: SavedAvatar[];
  disabled: boolean;
  onUse: (avatar: SavedAvatar) => void;
  onSelectCurrent: (avatar: SavedAvatar) => void;
};

function VersionPair({ versions, disabled, onUse, onSelectCurrent }: Props) {
  const [newest, previous] = versions;
  const [leftId, setLeft] = useState(previous.id);
  const [rightId, setRight] = useState(newest.id);
  const left = versions.find((avatar) => avatar.id === leftId) ?? previous;
  const right = versions.find((avatar) => avatar.id === rightId) ?? newest;
  const [zoom, setZoom] = useState(100);

  return (
    <section className="master-comparison" aria-label="Master avatar comparison">
      {versions.length > 2 && (
        <div className="master-comparison-grid">
          {[
            { label: "Left version", selected: left, other: right, select: setLeft },
            { label: "Right version", selected: right, other: left, select: setRight },
          ].map(({ label, selected, other, select }) => (
            <label key={label}>
              {label}
              <select
                value={selected.id}
                disabled={disabled}
                onChange={(event) => select(event.target.value)}
              >
                {versions
                  .filter(({ id }) => id !== other.id)
                  .map((avatar) => (
                    <option key={avatar.id} value={avatar.id}>
                      Version {versionNumber(avatar)} · {avatar.name}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
      )}
      <label className="avatar-reference-zoom">
        <span>Preview zoom</span>
        <input
          type="range"
          min={100}
          max={250}
          step={25}
          value={zoom}
          aria-valuetext={`${zoom}%`}
          onChange={(event) => setZoom(Number(event.target.value))}
        />
        <span aria-hidden="true">{zoom}%</span>
      </label>
      <div className="master-comparison-grid">
        {[left, right].map((avatar) => {
          const version = versionNumber(avatar);
          return (
            <article key={avatar.id} aria-label={`Master version ${version}`}>
              <VersionImage id={avatar.id} label={`Master version ${version}`} zoom={zoom} />
              <h3>Version {version}</h3>
              <p>{avatar.name}</p>
              {avatar.isCurrentMaster && (
                <p>
                  <strong>Current master</strong>
                </p>
              )}
              <p>
                {profiles.find(({ id }) => id === avatar.profileId)?.name} · {avatar.heightCm} cm ·{" "}
                {avatar.weightKg} kg
              </p>
              <p>
                {avatar.approvalStatus === "approved"
                  ? `Approved${avatar.approvedVersion ? ` · review ${avatar.approvedVersion}` : ""}`
                  : "Draft · Review required"}
              </p>
              <button
                type="button"
                className="button secondary"
                disabled={disabled}
                onClick={() => onUse(avatar)}
              >
                Open version {version}
              </button>
              {avatar.approvalStatus === "approved" && !avatar.isCurrentMaster && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={disabled}
                  onClick={() => onSelectCurrent(avatar)}
                >
                  Make version {version} current
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function AvatarMasterComparison({
  versions,
  disabled,
  onUse,
  onSelectCurrent,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="button secondary master-comparison-toggle"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {open ? "Close comparison" : "Compare master versions"}
      </button>
      {open && (
        <VersionPair
          versions={[...versions].sort((a, b) => versionNumber(b) - versionNumber(a))}
          disabled={disabled}
          onUse={onUse}
          onSelectCurrent={onSelectCurrent}
        />
      )}
    </>
  );
}
