export const garmentChoices = [
  ["dress", "Dress"],
  ["skirt", "Skirt"],
  ["saree", "Saree"],
  ["lehenga", "Lehenga"],
  ["blouse", "Blouse"],
  ["shirt", "Shirt"],
  ["tshirt", "T-shirt"],
  ["top", "Top"],
  ["blazer", "Blazer"],
  ["suit", "Suit"],
  ["jacket", "Jacket"],
  ["kurta", "Kurta"],
  ["trousers", "Trousers"],
  ["jeans", "Jeans"],
  ["shorts", "Shorts"],
  ["shoes", "Shoes"],
  ["outfit", "Full outfit"],
] as const;
export type GarmentType = (typeof garmentChoices)[number][0];

/** Cut and draped for the female body library only. */
export const femaleOnlyGarments: readonly string[] = [
  "dress",
  "skirt",
  "saree",
  "lehenga",
  "blouse",
];

// A women's "salwar suit" or a tracksuit is not a tailored suit.
const NOT_TAILORED_SUIT =
  /\b(salwar|shalwar|churidar|anarkali|patiala|sharara|palazzo|track|jogging|sweat|swim|jump|play|body|night)\s*(kameez\s*)?suits?\b/;
const SUIT_TROUSERS = /\bsuit\s+(trousers?|pants?)\b/;
const BLAZER = /\b(blazers?|suit jackets?|sports? (coat|jacket)|dinner jackets?|tuxedo jackets?)\b/;
const SUIT = /\b(suits?|tuxedos?)\b/;

/** Best guess from the product name; staff always confirm before generating. */
export function guessGarmentType(title: string): GarmentType | null {
  const t = title.toLowerCase();
  if (/saree|sari/.test(title.toLowerCase())) return "saree";
  if (/lehenga/.test(title.toLowerCase())) return "lehenga";
  if (/blouse/.test(title.toLowerCase())) return "blouse";
  if (/\bdress\b(?!\s+(shirt|shoes|pants|trousers|suit))/.test(t)) return "dress";
  if (/skirt/.test(title.toLowerCase())) return "skirt";
  if (/\b(jeans|denim pant)/.test(t)) return "jeans";
  if (/\b(t-?shirts?|tees?|polo)\b/.test(t)) return "tshirt";
  if (/\bkurta/.test(t)) return "kurta";
  if (NOT_TAILORED_SUIT.test(t)) return "outfit";
  if (BLAZER.test(t)) return "blazer";
  if (SUIT_TROUSERS.test(t)) return "trousers";
  if (SUIT.test(t)) return "suit";
  if (/\b(jacket|hoodie|sweatshirt|coat|overshirt)\b/.test(t)) return "jacket";
  if (/\bshorts\b/.test(t)) return "shorts";
  if (/\b(trousers?|pants?|chinos?|joggers?|track ?pants?|cargos?)\b/.test(t)) return "trousers";
  if (/\b(shoes?|sneakers?|loafers?|boots?|sandals?|slippers?|footwear)\b/.test(t)) return "shoes";
  if (/\bshirts?\b/.test(t)) return "shirt";
  if (/\b(set|co-?ord|suit|outfit)\b/.test(t)) return "outfit";
  return null;
}
