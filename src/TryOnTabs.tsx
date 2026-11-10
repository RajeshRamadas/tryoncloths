import { Gem, Shirt } from "lucide-react";

type Props = {
  current: "clothes" | "jewellery";
  avatarId: string;
  disabled?: boolean;
  onClothes?: () => void;
};

// One try-on space: staff switch between clothes and jewellery for the same saved avatar.
export default function TryOnTabs({ current, avatarId, disabled = false, onClothes }: Props) {
  const id = encodeURIComponent(avatarId);
  return (
    <nav className="try-on-tabs" aria-label="Try on">
      <button
        type="button"
        aria-current={current === "clothes" ? "page" : undefined}
        disabled={disabled}
        onClick={() => {
          if (current === "clothes") return;
          if (onClothes) onClothes();
          else location.assign("/?avatar=" + id);
        }}
      >
        <Shirt size={16} aria-hidden="true" /> Clothes
      </button>
      <button
        type="button"
        aria-current={current === "jewellery" ? "page" : undefined}
        disabled={disabled}
        onClick={() => {
          if (current !== "jewellery") location.assign("/jewellery?avatar=" + id);
        }}
      >
        <Gem size={16} aria-hidden="true" /> Jewellery
      </button>
    </nav>
  );
}
