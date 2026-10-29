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

// Six illustrative complexion ranges, not ethnic groups or calibrated colour
// measurements. Personalization still follows the customer's own photos.
export const skinTones = [
  { id: 'very-light', name: 'Very light', swatch: '#efd2bf' },
  { id: 'light', name: 'Light', swatch: '#dfb797' },
  { id: 'medium', name: 'Medium', swatch: '#c58f66' },
  { id: 'tan', name: 'Tan', swatch: '#a76c49' },
  { id: 'deep', name: 'Deep', swatch: '#774b37' },
  { id: 'very-deep', name: 'Very deep', swatch: '#4f3129' },
];
export const DEFAULT_TEMPLATE_TONE = 'medium';
export function validTemplateTone(tone) { return skinTones.some(t => t.id === tone); }
export function templateLibrary(body, tone = DEFAULT_TEMPLATE_TONE) {
  if (!['male', 'female'].includes(body) || !validTemplateTone(tone)) throw new Error('Choose an available body library and template skin tone.');
  if (tone === DEFAULT_TEMPLATE_TONE) return body === 'female' ? '/avatar-library-female.png' : '/avatar-library.png';
  return `/avatar-tones/${body}-${tone}.png`;
}
export const avatarVariants = profiles.flatMap(profile => skinTones.map(tone => ({
  id: `${profile.id}:${tone.id}`, profileId: profile.id, body: profile.body,
  templateTone: tone.id, library: templateLibrary(profile.body, tone.id), index: profile.index,
})));

export function approximateSelection(height, weight, body = 'male') {
  const profileId = recommendProfile(height, weight, body);
  if (!profileId) return null;
  const band = (value, min, max) => {
    const lower = min + Math.floor((value - min) / 10) * 10;
    return { min: lower, max: Math.min(max, lower + 10) };
  };
  return { profileId, heightBand: band(height, 140, body === 'female' ? 200 : 210), weightBand: band(weight, 35, 200) };
}

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
