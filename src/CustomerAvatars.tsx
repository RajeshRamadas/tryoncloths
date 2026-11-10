import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { accountAvatarImage, listAccountAvatars } from "./account-avatars";
import { avatarDataUrl, type AvatarDetails, type SavedAvatar } from "./saved-avatars";
import { profiles } from "./profiles";

type Props = {
  customerId: string;
  customerName: string;
  disabled: boolean;
  onUse: (image: string, details: AvatarDetails) => void;
};

// A returning customer's saved avatars, shown as soon as staff find them, so they can go
// straight back to trying clothes without opening Saved avatars or generating again.
export default function CustomerAvatars({ customerId, customerName, disabled, onUse }: Props) {
  const [items, setItems] = useState<SavedAvatar[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setItems(null);
    setError("");
    listAccountAvatars()
      .then((all) => {
        if (alive) setItems(all.filter((a) => a.customerId === customerId));
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [customerId]);
  async function open(item: SavedAvatar) {
    setBusy(true);
    setError("");
    try {
      const image = await avatarDataUrl(await accountAvatarImage(item.id));
      onUse(image, { ...item, avatarId: item.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (items === null && !error)
    return <p className="customer-avatars-status">Checking saved avatars…</p>;
  return (
    <section className="customer-avatars" aria-label={`Saved avatars for ${customerName}`}>
      {items && items.length > 0 ? (
        <>
          <h4>Saved avatars</h4>
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {profiles.find((p) => p.id === item.profileId)?.name || "Custom"} ·{" "}
                    {item.heightCm} cm / {item.weightKg} kg
                  </small>
                </span>
                <button
                  type="button"
                  className="button primary"
                  disabled={disabled || busy}
                  aria-label={`Open ${item.name} for try-on`}
                  onClick={() => void open(item)}
                >
                  Open <ArrowRight size={16} />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        items && (
          <p className="customer-avatars-status">
            No saved avatar yet. Add photos below to create one.
          </p>
        )
      )}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
    </section>
  );
}
