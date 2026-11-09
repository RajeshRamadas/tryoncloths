import type { Category } from "./outfits";
import type { GarmentColour } from "./garment-colours";

export type SampleGarment = {
  id: string;
  name: string;
  category: Category;
  source: string;
  colour?: GarmentColour;
};

type Variant = readonly [id: string, name: string, hex: string];
function variants(
  category: Category,
  source: string,
  reference: number,
  colours: readonly Variant[],
): SampleGarment[] {
  return colours.map(([id, name, hex]) => ({
    id,
    name,
    category,
    source: `/garments/${source}.webp`,
    colour: { hex, reference },
  }));
}
function original(category: Category, id: string, name: string): SampleGarment {
  return { id, name, category, source: `/garments/${id}.webp` };
}

// Reuse the nine prepared transparent textures. Colour variants keep the same
// silhouette and shading; no customer image or provider request is involved.
export const SAMPLE_GARMENTS: readonly SampleGarment[] = [
  original("shirt", "navy-tee", "Navy T-shirt"),
  original("shirt", "cream-tee", "Cream T-shirt"),
  original("shirt", "blue-shirt", "Blue button-down shirt"),
  ...variants("shirt", "cream-tee", 212, [
    ["white-tee", "White T-shirt", "#eeeeea"],
    ["black-tee", "Black T-shirt", "#272a2e"],
    ["grey-tee", "Grey T-shirt", "#85898c"],
    ["red-tee", "Red T-shirt", "#b94343"],
    ["burgundy-tee", "Burgundy T-shirt", "#763747"],
    ["forest-tee", "Forest green T-shirt", "#355e4c"],
    ["olive-tee", "Olive T-shirt", "#777957"],
    ["cobalt-tee", "Cobalt blue T-shirt", "#416ba9"],
    ["blush-tee", "Blush pink T-shirt", "#d8adb3"],
    ["lavender-tee", "Lavender T-shirt", "#aaa0c5"],
  ]),
  ...variants("shirt", "blue-shirt", 164, [
    ["white-shirt", "White button-down shirt", "#e9e9e3"],
    ["black-shirt", "Black button-down shirt", "#303237"],
    ["navy-shirt", "Navy button-down shirt", "#34475f"],
    ["sage-shirt", "Sage green button-down shirt", "#96a58b"],
    ["pink-shirt", "Pink button-down shirt", "#d7b1b6"],
    ["beige-shirt", "Beige button-down shirt", "#c5b59d"],
    ["burgundy-shirt", "Burgundy button-down shirt", "#783d4e"],
  ]),
  original("trousers", "blue-jeans", "Blue jeans"),
  original("trousers", "charcoal-chinos", "Charcoal chinos"),
  original("trousers", "sand-chinos", "Sand chinos"),
  ...variants("trousers", "blue-jeans", 106, [
    ["black-jeans", "Black jeans", "#323438"],
    ["indigo-jeans", "Indigo jeans", "#34465f"],
    ["grey-jeans", "Grey jeans", "#929495"],
    ["light-blue-jeans", "Light blue jeans", "#a3bdcf"],
    ["white-jeans", "White jeans", "#dfdfd8"],
  ]),
  ...variants("trousers", "sand-chinos", 170, [
    ["navy-chinos", "Navy chinos", "#3a4961"],
    ["black-chinos", "Black chinos", "#303237"],
    ["olive-chinos", "Olive chinos", "#72785a"],
    ["cream-chinos", "Cream chinos", "#e1d9c6"],
    ["burgundy-chinos", "Burgundy chinos", "#7d4651"],
  ]),
  original("shoes", "white-sneakers", "White sneakers"),
  original("shoes", "black-sneakers", "Black sneakers"),
  original("shoes", "brown-shoes", "Brown leather shoes"),
  ...variants("shoes", "black-sneakers", 47, [
    ["grey-sneakers", "Grey sneakers", "#777c80"],
    ["navy-sneakers", "Navy sneakers", "#33455e"],
    ["tan-sneakers", "Tan sneakers", "#ad9171"],
    ["red-sneakers", "Red sneakers", "#a54845"],
    ["forest-sneakers", "Forest green sneakers", "#3d604d"],
  ]),
  ...variants("shoes", "brown-shoes", 84, [
    ["black-shoes", "Black leather shoes", "#303034"],
    ["tan-shoes", "Tan leather shoes", "#b38a5e"],
    ["burgundy-shoes", "Burgundy leather shoes", "#713d46"],
  ]),
];

export const SAMPLE_OUTFITS = [
  {
    id: "weekend",
    name: "Weekend casual",
    garments: ["white-tee", "blue-jeans", "white-sneakers"],
  },
  { id: "office", name: "Office classic", garments: ["blue-shirt", "navy-chinos", "brown-shoes"] },
  { id: "earth", name: "Earth tones", garments: ["forest-tee", "sand-chinos", "tan-sneakers"] },
  {
    id: "monochrome",
    name: "Monochrome",
    garments: ["black-tee", "black-jeans", "black-sneakers"],
  },
  {
    id: "summer",
    name: "Summer light",
    garments: ["sage-shirt", "cream-chinos", "white-sneakers"],
  },
  {
    id: "evening",
    name: "Evening smart",
    garments: ["burgundy-shirt", "charcoal-chinos", "black-shoes"],
  },
  { id: "colour", name: "Colour pop", garments: ["cobalt-tee", "grey-jeans", "red-sneakers"] },
  {
    id: "pastels",
    name: "Soft pastels",
    garments: ["blush-tee", "light-blue-jeans", "grey-sneakers"],
  },
] as const;
