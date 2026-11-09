import { resolveHandsGeometry } from "./hands-geometry.js";
import { previewLabel } from "../src/jewellery-overlay.js";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { jewellerySelection } from "./jewellery-tryon.js";
import { jewelleryMetals } from "./jewellery-types.js";
import { jewelleryPng } from "./jewellery-store.js";

export const JEWELLERY_PREVIEW_LABEL = "AI preview — actual piece may differ in detail";
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function labelledJewelleryImage(image, mode = "ai") {
  const { width } = await sharp(image, { limitInputPixels: 25_000_000 }).metadata(),
    height = 52;
  const text = Buffer.from(
    `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/><text x="50%" y="32" text-anchor="middle" font-family="sans-serif" font-size="${Math.min(20, width / 28)}" fill="#294b3c">${previewLabel(mode)}</text></svg>`,
  );
  return sharp(image, { limitInputPixels: 25_000_000 })
    .extend({ bottom: height, background: "#fff" })
    .composite([{ input: text, gravity: "south" }])
    .png()
    .toBuffer();
}
export function jewelleryLook(store, account, id) {
  const row =
    typeof id === "string" &&
    store.db
      .prepare("SELECT * FROM looks WHERE account=? AND id=? AND itemsJson<>'[]'")
      .get(account.id, id);
  if (!row) throw fail("Saved jewellery look not found.", 404);
  return row;
}
export function jewelleryItems(store, account, items, view) {
  if (!Array.isArray(items) || !items.length || items.length > 10)
    throw fail("Use one to ten jewellery pieces in a saved look.");
  return items.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).some(
        (k) =>
          ![
            "mode",
            "view",
            "itemId",
            "name",
            "type",
            "attributes",
            "side",
            "finger",
            "hand",
            "wrist",
            "replaceExisting",
            "resultId",
          ].includes(k),
      )
    )
      throw fail("Use supported jewellery look item details.");
    if (item.mode !== undefined && !["ai", "overlay"].includes(item.mode))
      throw fail("Choose a supported jewellery preview mode.");
    let attributes = item.attributes,
      name = item.name;
    if (item.itemId) {
      const row = store.garments.row(account, item.itemId, {
        category: "jewellery",
        jewelleryEnabled: true,
      });
      if (row.garmentType !== item.type)
        throw fail("The jewellery type changed. Review the item again.", 409);
      attributes = {
        ...JSON.parse(row.attributesJson),
        ...(item.type === "bangles" && item.attributes?.count !== undefined
          ? { count: item.attributes.count }
          : {}),
      };
      name = row.name;
    }
    if (typeof name !== "string" || !name.trim() || name.length > 100)
      throw fail("Give each jewellery piece a name up to 100 characters.");
    const selected = jewellerySelection({ ...item, attributes, view });
    return {
      name: name.trim(),
      ...selected,
      ...(item.mode === "overlay" ? { mode: "overlay" } : {}),
      itemId: item.itemId || null,
      ...(typeof item.resultId === "string" && /^[a-f0-9]{64}$/.test(item.resultId)
        ? { resultId: item.resultId }
        : {}),
    };
  });
}
export async function saveJewelleryLook(store, jewellery, account, input, guard) {
  if (input.reviewed !== true || input.storageConsent !== true)
    throw fail("Review the complete jewellery look and confirm customer agreement to save it.");
  const items = jewelleryItems(store, account, input.itemsJson, input.view),
    image = await jewelleryPng(input.image, input.view);
  guard();
  let claims,
    previewMode = "ai",
    handsPacket;
  if (input.receipt) {
    claims = jewellery.claims(account, input.receipt);
    previewMode = claims.previewMode || "ai";
    handsPacket = claims.handsGeometry;
    if (
      claims.avatarId !== input.avatarId ||
      claims.view !== input.view ||
      claims.imageHash !== hash(image)
    )
      throw fail("Use the original reviewed jewellery result for this avatar and view.", 409);
    const last = items.at(-1);
    if (claims.itemId !== last.itemId || (claims.selection && claims.selection.type !== last.type))
      throw fail("The final jewellery piece does not match its result.", 409);
  } else if (input.resultId) {
    const row = store.db
      .prepare("SELECT * FROM garment_results WHERE account=? AND id=? AND avatarId=? AND view=?")
      .get(account.id, input.resultId, input.avatarId, input.view);
    previewMode = row?.previewMode || "ai";
    if (row?.handsGeometryJson) handsPacket = JSON.parse(row.handsGeometryJson);
    if (!row || hash(row.image) !== hash(image) || row.garmentId !== items.at(-1).itemId)
      throw fail("The approved jewellery result is unavailable.", 409);
  } else if (input.baseLookId) {
    const row = jewelleryLook(store, account, input.baseLookId);
    previewMode = row.previewMode;
    if (row.handsGeometryJson) handsPacket = JSON.parse(row.handsGeometryJson);
    if (
      row.avatarId !== input.avatarId ||
      row.view !== input.view ||
      hash(row.image) !== hash(image)
    )
      throw fail("Use the original saved jewellery look.", 409);
  } else
    throw fail(
      "A verified jewellery result or saved look is required. Keep or download the reviewed preview if its receipt is unavailable.",
      409,
    );
  const check = () => {
    guard();
    if (claims) jewellery.current(account, claims);
  };
  check();
  const labels = items.map((i) =>
    [i.name, jewelleryMetals.find(([id]) => id === i.attributes.metal)?.[1], i.attributes.purity]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 120),
  );
  const geometry =
    input.view === "hands"
      ? await resolveHandsGeometry(store, account, input.avatarId, handsPacket, {
          requirePacket: true,
        })
      : null;
  check();
  return store.saveLook(
    account,
    { ...input, garments: labels, garmentIds: items.flatMap((i) => (i.itemId ? [i.itemId] : [])) },
    {
      view: input.view,
      itemsJson: items,
      previewMode,
      handsGeometry: geometry?.packet,
      guard: check,
    },
  );
}
