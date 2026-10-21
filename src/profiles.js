export const profiles = [
  { id: "slim", name: "Slim", description: "A narrower frame", index: 0 },
  { id: "regular", name: "Regular", description: "An average frame", index: 1 },
  {
    id: "athletic",
    name: "Athletic",
    description: "A muscular frame",
    index: 2,
  },
  { id: "broad", name: "Broad", description: "A fuller frame", index: 3 },
];

/** Prototype heuristic only. Weight and height cannot identify muscle or actual proportions. */
export function recommendProfile(height, weight) {
  if (
    !Number.isFinite(height) ||
    !Number.isFinite(weight) ||
    height < 140 ||
    height > 210 ||
    weight < 35 ||
    weight > 200
  ) {
    return null;
  }
  const ratio = weight / (height / 100) ** 2;
  return ratio < 20 ? "slim" : ratio < 27 ? "regular" : "broad";
}
