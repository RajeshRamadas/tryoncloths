// Shared catalogue metadata only: imported by the browser and server. Never add
// provider credentials, node imports or paid execution to this file.
const keep =
  "Keep the face, expression, complexion, hair, clothing, background and unrequested jewellery unchanged.";
const item = (label, view, placement, options = {}) => ({
  label,
  view,
  pair: false,
  sides: [],
  needsFinger: false,
  needsWrist: false,
  placement,
  keep,
  ...options,
});
const paired = { pair: true, sides: ["left", "right", "both"] };
export const jewelleryTypes = {
  stud_earrings: item(
    "Stud earrings",
    "portrait",
    "Place the matched studs at the earlobes.",
    paired,
  ),
  drop_earrings: item(
    "Drop / chandbali earrings",
    "portrait",
    "Hang the matched drops from the earlobes, respecting their drop length.",
    paired,
  ),
  jhumka: item(
    "Jhumka earrings",
    "portrait",
    "Hang the matched jhumkas from the earlobes, preserving their bell shape and drop.",
    paired,
  ),
  nose_pin: item("Nose pin", "portrait", "Place one pin at the selected nostril.", {
    sides: ["left", "right"],
  }),
  nose_ring: item(
    "Nose ring / nath",
    "portrait",
    "Place one ring at the selected nostril; include a chain only if part of the product.",
    { sides: ["left", "right"] },
  ),
  maang_tikka: item(
    "Maang tikka",
    "portrait",
    "Place the pendant at the upper forehead along the hair parting.",
  ),
  matha_patti: item(
    "Matha patti",
    "portrait",
    "Place the headpiece along the hairline and forehead without changing the hairstyle.",
  ),
  choker: item("Choker", "portrait", "Place the choker close to the base of the neck."),
  necklace: item(
    "Necklace / chain",
    "portrait",
    "Drape the necklace at the length specified by the catalogue.",
  ),
  pendant: item(
    "Pendant",
    "portrait",
    "Place the pendant and supplied chain at the specified necklace length.",
  ),
  long_haar: item(
    "Long / rani haar",
    "full",
    "Drape the long haar over the current outfit, down the chest.",
  ),
  mangalsutra: item(
    "Mangalsutra",
    "portrait",
    "Place only the supplied necklace at its catalogue length; add no other marital symbols.",
  ),
  ring: item("Ring", "hands", "Place one ring on the chosen hand and finger.", {
    sides: ["left", "right"],
    needsFinger: true,
  }),
  bangles: item(
    "Bangles / kada",
    "hands",
    "Place the specified count of bangles around the selected wrist or wrists.",
    { sides: ["left", "right", "both"], needsWrist: true },
  ),
  bracelet: item("Bracelet", "hands", "Place the bracelet around the selected wrist.", {
    sides: ["left", "right", "both"],
    needsWrist: true,
  }),
  watch: item(
    "Watch",
    "hands",
    "Place the watch around the selected wrist with the dial naturally oriented.",
    { sides: ["left", "right"], needsWrist: true },
  ),
  waist_belt: item(
    "Waist belt / kamarbandh",
    "full",
    "Place the belt around the waist over the current outfit.",
  ),
  anklets: item(
    "Anklets / payal",
    "full",
    "Place the matched anklets around the ankles with both feet visible.",
    paired,
  ),
};
export const jewelleryMetals = [
  ["yellow_gold", "Yellow gold"],
  ["rose_gold", "Rose gold"],
  ["white_gold", "White gold"],
  ["silver", "Silver"],
  ["platinum", "Platinum"],
  ["oxidised", "Oxidised"],
  ["imitation_gold", "Imitation gold"],
];
export const bangleSizes = ["2.2", "2.4", "2.6", "2.8", "2.10", "2.12"];
export function jewelleryView(type, lengthCm) {
  return ["necklace", "pendant", "mangalsutra"].includes(type) && lengthCm > 50
    ? "full"
    : jewelleryTypes[type]?.view;
}
