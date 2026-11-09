import { jewelleryTypes } from "./jewellery-definitions.js";
export {
  jewelleryMetals,
  bangleSizes,
  jewelleryView,
  jewelleryTypes,
} from "./jewellery-definitions.js";
export type JewelleryType = keyof typeof jewelleryTypes;
export type JewelleryAttributes = {
  metal: string;
  variantOf?: string;
  purity?: string;
  stones?: string;
  weightG?: number;
  lengthCm?: number;
  dropMm?: number;
  pendantMm?: number;
  ringSizeIn?: number;
  bangleSize?: string;
  count?: number;
  pair?: boolean;
  huid?: string;
};
export const jewelleryChoices = Object.entries(jewelleryTypes).map(([id, item]) => [
  id,
  item.label,
]) as [JewelleryType, string][];
/** A title hint only; staff explicitly choose the saved type and metal. */
export function guessJewelleryType(title: string): JewelleryType | null {
  if (typeof title !== "string") return null;
  const t = title.toLowerCase();
  if (/\btoe\s*rings?\b/.test(t)) return null;
  const rules: [RegExp, JewelleryType][] = [
    [/\bmatha\s*patti\b/, "matha_patti"],
    [
      /\b(?:passa|jhoomar|jhumar|hair\s*(?:clips?|pins?|accessor(?:y|ies)|brooch(?:es)?)|hairpins?|barrettes?)\b/,
      "hair_accessory",
    ],
    [/\bnath\b.*\bchain\b|\bchain\b.*\bnath\b|\bnose\s*rings?\s+with\s+chain\b/, "nath_chain"],
    [/\b(?:maang\s*)?tikka\b/, "maang_tikka"],
    [/\bnose\s*(?:pin|stud)s?\b/, "nose_pin"],
    [/\b(?:nose\s*rings?|nath)\b/, "nose_ring"],
    [/\bjhumk[ai]s?\b/, "jhumka"],
    [/\bchandbalis?\b|\bdrop\s*earrings?\b/, "drop_earrings"],
    [/\bstud(?:s|\s*earrings?)?\b/, "stud_earrings"],
    [/\bearrings?\b/, "drop_earrings"],
    [/\b(?:waist\s*belt|kamarbandh?|oddiyanam)\b/, "waist_belt"],
    [/\b(?:anklets?|payal)\b/, "anklets"],
    [/\b(?:bangles?|kada)\b/, "bangles"],
    [/\bbracelets?\b/, "bracelet"],
    [/\bwatches?\b|\bwatch\b/, "watch"],
    [/\brings?\b/, "ring"],
    [/\bmangalsutra\b/, "mangalsutra"],
    [/\b(?:long\s*haar|rani\s*haar|haar|haaram)\b/, "long_haar"],
    [/\bchokers?\b/, "choker"],
    [/\bpendants?\b/, "pendant"],
    [/\b(?:necklaces?|chains?)\b/, "necklace"],
  ];
  return rules.find(([pattern]) => pattern.test(t))?.[1] ?? null;
}
