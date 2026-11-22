import { useState } from "react";
import { listAvatarVersions, type AvatarVersion } from "./account-avatars";
import { profiles } from "./profiles";

export default function AvatarVersionHistory({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<AvatarVersion[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(before?: number) {
    if (before === undefined) {
      setVersions([]);
      setNextBefore(null);
    }
    setError("");
    setLoading(true);
    try {
      const page = await listAvatarVersions(id, before);
      setVersions((current) => [...current, ...page.versions]);
      setNextBefore(page.nextBefore);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="button secondary"
        aria-label={`Version history for ${name}`}
        aria-expanded={open}
        disabled={loading}
        onClick={() => {
          setOpen(!open);
          if (!open) void load();
        }}
      >
        Version history
      </button>
      {open && (
        <section className="avatar-version-history" aria-label={`Approved versions for ${name}`}>
          {versions.length > 0 && (
            <ul>
              {versions.map((entry) => (
                <li key={entry.version}>
                  <strong>
                    Version {entry.version}
                    {entry.current ? " · Active" : entry.revokedAt != null ? " · Revoked" : ""}
                  </strong>
                  {entry.name !== name && <p>{entry.name}</p>}
                  <p>
                    {profiles.find((p) => p.id === entry.profileId)?.name} · {entry.heightCm} cm ·{" "}
                    {entry.weightKg} kg
                  </p>
                  <p>{new Date(entry.approvedAt).toLocaleString()}</p>
                  {entry.revokedAt != null && (
                    <p>Revoked {new Date(entry.revokedAt).toLocaleString()}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {loading && <p role="status">Loading versions…</p>}
          {error && <p role="alert">{error}</p>}
          {!loading && !error && versions.length === 0 && <p>No version history yet.</p>}
          {nextBefore !== null && (
            <button
              type="button"
              className="button secondary"
              disabled={loading}
              onClick={() => void load(nextBefore)}
            >
              Load earlier versions
            </button>
          )}
        </section>
      )}
    </>
  );
}
