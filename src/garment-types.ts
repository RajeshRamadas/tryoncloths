export const garmentChoices = [
  ["dress","Dress"], ["skirt","Skirt"], ["saree","Saree"], ["lehenga","Lehenga"], ["blouse","Blouse"],
  ["shirt", "Shirt"], ["tshirt", "T-shirt"], ["top", "Top"], ["jacket", "Jacket"], ["kurta", "Kurta"],
  ["trousers", "Trousers"], ["jeans", "Jeans"], ["shorts", "Shorts"], ["shoes", "Shoes"], ["outfit", "Full outfit"],
] as const;
export type GarmentType = (typeof garmentChoices)[number][0];

/** Best guess from the product name; staff always confirm before generating. */
export function guessGarmentType(title: string): GarmentType | null {
  const t = title.toLowerCase();
  if (/saree|sari/.test(title.toLowerCase())) return "saree";
  if (/lehenga/.test(title.toLowerCase())) return "lehenga";
  if (/blouse/.test(title.toLowerCase())) return "blouse";
  if (/\bdress\b(?!\s+(shirt|shoes|pants|trousers))/.test(t)) return "dress";
  if (/skirt/.test(title.toLowerCase())) return "skirt";
  if (/\b(jeans|denim pant)/.test(t)) return "jeans";
  if (/\b(t-?shirts?|tees?|polo)\b/.test(t)) return "tshirt";
  if (/\bkurta/.test(t)) return "kurta";
  if (/\b(jacket|blazer|hoodie|sweatshirt|coat|overshirt)\b/.test(t)) return "jacket";
  if (/\bshorts\b/.test(t)) return "shorts";
  if (/\b(trousers?|pants?|chinos?|joggers?|track ?pants?|cargos?)\b/.test(t)) return "trousers";
  if (/\b(shoes?|sneakers?|loafers?|boots?|sandals?|slippers?|footwear)\b/.test(t)) return "shoes";
  if (/\bshirts?\b/.test(t)) return "shirt";
  if (/\b(set|co-?ord|suit|outfit)\b/.test(t)) return "outfit";
  return null;
}
