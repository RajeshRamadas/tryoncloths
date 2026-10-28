const maleProfiles = [
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
export const profiles = [
  ...maleProfiles.map(p => ({...p, body:"male", clothing:"grey T-shirt and charcoal shorts"})),
  ...[ ["f-slim","Slim","A narrower frame"], ["f-regular","Regular","An average frame"], ["f-athletic","Athletic","A muscular frame"], ["f-curvy","Curvy","A fuller frame"] ].map(([id,name,description],i)=>({id,name,description,index:i+4,body:"female",clothing:"grey crew-neck T-shirt and charcoal mid-thigh shorts"})),
];

/** Prototype heuristic only. Weight and height cannot identify muscle or actual proportions. */
export function recommendProfile(height, weight, body = "male") {
  if (
    !["male", "female"].includes(body) ||
    !Number.isFinite(height) ||
    !Number.isFinite(weight) ||
    height < 140 ||
    height > (body === "female" ? 200 : 210) ||
    weight < 35 ||
    weight > 200
  ) {
    return null;
  }
  const ratio = weight / (height / 100) ** 2;
  if (body === "female") return ratio < 20 ? "f-slim" : ratio < 27 ? "f-regular" : "f-curvy";
  return ratio < 20 ? "slim" : ratio < 27 ? "regular" : "broad";
}
