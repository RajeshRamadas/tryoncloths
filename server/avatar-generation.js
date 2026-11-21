import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function pngHash(image) {
  return createHash("sha256")
    .update(Buffer.from(image.slice(image.indexOf(",") + 1), "base64"))
    .digest("hex");
}

function signature(key, payload) {
  // Separate these receipts from the view and jewellery receipts using the same key.
  return createHmac("sha256", key).update("forme:avatar-generation:v1:").update(payload).digest();
}

export function issueAvatarGenerationReceipt(key, account, customerId, image, generation) {
  const payload = Buffer.from(
    JSON.stringify({
      store: account.id,
      user: account.user.id,
      customer: customerId ?? null,
      generation: { ...generation, outputSha256: pngHash(image) },
    }),
  ).toString("base64url");
  return `${payload}.${signature(key, payload).toString("hex")}`;
}

export function verifyAvatarGenerationReceipt(key, account, input) {
  const { generationReceipt, source, image, customerId, regenerateFromId } = input;
  if (generationReceipt == null && regenerateFromId == null) return null;
  try {
    if (
      source !== "generated" ||
      typeof generationReceipt !== "string" ||
      generationReceipt.length > 4096
    )
      throw new Error();
    const [payload, mac, extra] = generationReceipt.split(".");
    if (
      extra !== undefined ||
      !/^[a-f0-9]{64}$/.test(mac) ||
      !timingSafeEqual(signature(key, payload), Buffer.from(mac, "hex"))
    )
      throw new Error();
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      claims.store !== account.id ||
      claims.user !== account.user.id ||
      claims.customer !== (customerId ?? null) ||
      (claims.generation.regenerateFromId ?? null) !== (regenerateFromId ?? null) ||
      claims.generation.outputSha256 !== pngHash(image)
    )
      throw new Error();
    return claims.generation;
  } catch {
    throw Object.assign(
      new Error("The generation receipt does not match this avatar or store session."),
      { status: 400 },
    );
  }
}
