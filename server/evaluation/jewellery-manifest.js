import { profiles } from "../../src/profiles.js";
import { jewelleryTypes, validateAttributes, chooseView } from "../jewellery-types.js";
export const jewelleryRubric = {
  placement: "Placement on the requested anatomy",
  fidelity: "Recognisably the same jewellery design",
  identity: "Customer likeness and complexion",
};
export const jewelleryFailures = [
  "quota",
  "timeout",
  "network",
  "blocked",
  "no_image",
  "invalid_image",
  "missing_face",
  "identity_mismatch",
  "framing_changed",
  "hands_changed",
  "face_check",
  "credentials",
  "model",
  "unavailable",
  "request",
  "response",
  "unknown",
];
export const evaluationId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,60}$/.test(value);
const label = (v) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= 120 && !/[\x00-\x1f\x7f]/.test(v);
export function onlyFields(value, allowed) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    throw new Error("Use only the documented evaluation fields.");
}
function unique(rows, label) {
  const ids = new Set();
  for (const row of rows) {
    if (!evaluationId(row?.id) || ids.has(row.id))
      throw new Error(`Use unique, anonymized ${label} IDs.`);
    ids.add(row.id);
  }
}
function imagePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1024 ||
    /[\x00-\x1f\x7f]/.test(value) ||
    /^[a-z]+:/i.test(value)
  )
    throw new Error("Use a local image path inside the manifest folder.");
  return value;
}
export function validateJewelleryManifest(input) {
  onlyFields(input, [
    "version",
    "kind",
    "identityThreshold",
    "collection",
    "providers",
    "items",
    "portraits",
    "results",
  ]);
  if (
    input.version !== 1 ||
    input.kind !== "jewellery-evaluation" ||
    !Array.isArray(input.items) ||
    !input.items.length ||
    input.items.length > 30 ||
    !Array.isArray(input.portraits) ||
    !input.portraits.length ||
    input.portraits.length > 10 ||
    !Array.isArray(input.providers) ||
    !input.providers.length ||
    input.providers.length > 4 ||
    !Array.isArray(input.results) ||
    input.results.length > 1200
  )
    throw new Error(
      "Use version 1, 1–30 jewellery items, 1–10 portraits, 1–4 providers and at most 1200 outcomes.",
    );
  unique(input.items, "item");
  unique(input.portraits, "portrait");
  unique(input.providers, "provider");
  const threshold = input.identityThreshold ?? 0.45;
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1)
    throw new Error("Use an identity threshold above 0 and at most 1.");
  const collection = input.collection ?? "accepted-only";
  if (!["accepted-only", "all-candidates"].includes(collection))
    throw new Error("Record accepted-only or all-candidates collection.");
  const providers = input.providers.map((p) => {
    onlyFields(p, ["id", "label", "model", "mode", "evidence"]);
    if (
      !label(p.label) ||
      !label(p.model) ||
      !["ai", "overlay"].includes(p.mode) ||
      !["live", "fixture"].includes(p.evidence)
    )
      throw new Error("Providers need a label, model, AI/overlay mode and live/fixture evidence.");
    return { ...p };
  });
  const items = input.items.map((i) => {
    onlyFields(i, ["id", "name", "type", "attributes", "side", "image", "storageConsent"]);
    if (i.storageConsent !== true || !label(i.name) || !Object.hasOwn(jewelleryTypes, i.type))
      throw new Error("Each item needs product-storage permission, a name and a supported type.");
    const attributes = validateAttributes(i.type, i.attributes);
    if (chooseView(i.type, attributes) !== "portrait")
      throw new Error(
        "This 30 × 10 matrix evaluates portrait jewellery. Hands/full-body checks remain in the studio regression suite.",
      );
    if (!jewelleryTypes[i.type].sides.length && i.side != null)
      throw new Error("This jewellery type does not accept a side.");
    if (jewelleryTypes[i.type].sides.length && !["left", "right", "both"].includes(i.side))
      throw new Error("Choose an explicit side for portrait pieces.");
    if (
      (["nose_pin", "nose_ring", "nath_chain"].includes(i.type) && i.side === "both") ||
      (jewelleryTypes[i.type].pair && attributes.pair && i.side !== "both") ||
      (jewelleryTypes[i.type].pair && !attributes.pair && i.side === "both")
    )
      throw new Error("Use the item’s requested single side or matched pair.");
    return {
      id: i.id,
      name: i.name,
      type: i.type,
      attributes,
      side: i.side ?? null,
      image: imagePath(i.image),
    };
  });
  const portraits = input.portraits.map((p) => {
    onlyFields(p, ["id", "profileId", "image", "storageConsent"]);
    if (p.storageConsent !== true || !profiles.some((v) => v.id === p.profileId))
      throw new Error("Each portrait needs storage permission and a known body profile.");
    return { id: p.id, profileId: p.profileId, image: imagePath(p.image) };
  });
  const seen = new Set(),
    results = input.results.map((r) => {
      onlyFields(r, [
        "itemId",
        "portraitId",
        "providerId",
        "image",
        "failureCode",
        "latencyMs",
        "costUsd",
      ]);
      if (
        !items.some((i) => i.id === r.itemId) ||
        !portraits.some((p) => p.id === r.portraitId) ||
        !providers.some((p) => p.id === r.providerId)
      )
        throw new Error("Every outcome must match a known item, portrait and provider.");
      const key = [r.itemId, r.portraitId, r.providerId].join("/");
      if (seen.has(key))
        throw new Error(
          "Use one outcome per item/portrait/provider; record separate attempts in separate runs.",
        );
      seen.add(key);
      if (
        Boolean(r.image) === Boolean(r.failureCode) ||
        (r.failureCode && !jewelleryFailures.includes(r.failureCode))
      )
        throw new Error("Record either a local output image or a documented failure code.");
      for (const [key, max] of [
        ["latencyMs", 3600000],
        ["costUsd", 1000],
      ])
        if (r[key] != null && (!Number.isFinite(r[key]) || r[key] < 0 || r[key] > max))
          throw new Error("Latency/cost must be nonnegative bounded numbers or null.");
      return {
        itemId: r.itemId,
        portraitId: r.portraitId,
        providerId: r.providerId,
        ...(r.image ? { image: imagePath(r.image) } : { failureCode: r.failureCode }),
        latencyMs: r.latencyMs ?? null,
        costUsd: r.costUsd ?? null,
      };
    });
  return {
    version: 1,
    kind: "jewellery-evaluation",
    identityThreshold: threshold,
    collection,
    providers,
    items,
    portraits,
    results,
  };
}
export function jewelleryTemplate() {
  const types = [
    "stud_earrings",
    "drop_earrings",
    "jhumka",
    "nose_pin",
    "nose_ring",
    "nath_chain",
    "maang_tikka",
    "matha_patti",
    "hair_accessory",
    "choker",
    "necklace",
    "pendant",
    "mangalsutra",
  ];
  return {
    version: 1,
    kind: "jewellery-evaluation",
    identityThreshold: 0.45,
    collection: "accepted-only",
    providers: [
      {
        id: "gemini",
        label: "Gemini pilot",
        model: "gemini-2.5-flash-image",
        mode: "ai",
        evidence: "fixture",
      },
    ],
    items: Array.from({ length: 30 }, (_, i) => {
      const type = types[i % types.length],
        id = "item-" + String(i + 1).padStart(2, "0"),
        s = jewelleryTypes[type];
      return {
        id,
        name: s.label + " " + (i + 1),
        type,
        attributes: {
          metal: ["yellow_gold", "silver", "rose_gold"][i % 3],
          ...(s.pair ? { pair: true } : {}),
          ...(["drop_earrings", "jhumka"].includes(type) ? { dropMm: 38 } : {}),
          ...(["necklace", "pendant", "mangalsutra"].includes(type) ? { lengthCm: 45 } : {}),
        },
        ...(s.sides.length ? { side: s.pair ? "both" : "left" } : {}),
        image: "inputs/" + id + ".png",
        storageConsent: false,
      };
    }),
    portraits: Array.from({ length: 10 }, (_, i) => ({
      id: "portrait-" + String(i + 1).padStart(2, "0"),
      profileId: i < 5 ? "regular" : "f-regular",
      image: "inputs/portrait-" + String(i + 1).padStart(2, "0") + ".png",
      storageConsent: false,
    })),
    results: [],
  };
}
