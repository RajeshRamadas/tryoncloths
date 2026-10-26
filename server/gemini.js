import sharp from "sharp";
import { profiles, recommendProfile } from "../src/profiles.js";
import { geminiAvatarPrompt } from "./avatar-prompt.js";
import { geminiBodyReference } from "./gemini-reference.js";
import { ProviderError, providerRequest, providerJson } from "./provider-errors.js";

export const GEMINI_REFERENCE_VERSION = "customer-first-v1";

export async function geminiPersonalize({ face, body, avatar, profileId, measurements, apiKey, model = "gemini-2.5-flash-image", fetchImpl = fetch }) {
  if (!apiKey || !/^[a-zA-Z0-9.-]+$/.test(model)) throw new ProviderError("configuration");
  if (!profiles.some(profile => profile.id === profileId) || !face || !body || !avatar || !recommendProfile(measurements?.heightCm, measurements?.weightKg))
    throw new Error("Customer photos, measurements and a standard profile are required.");
  const bodyReference = await geminiBodyReference(avatar);
  const response = await providerRequest(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(180000),
    body: JSON.stringify({
      contents: [{ parts: [
        { text: geminiAvatarPrompt(profileId, measurements) },
        { text: "Image 1 — CUSTOMER FACE. Preserve this face, hair and glasses." },
        { inlineData: { mimeType: "image/jpeg", data: face.toString("base64") } },
        { text: "Image 2 — CUSTOMER FULL-BODY PHOTO. Supporting customer complexion reference." },
        { inlineData: { mimeType: "image/jpeg", data: body.toString("base64") } },
        { text: "Image 3 — STANDARD BODY GEOMETRY ONLY. Head blanked and colours removed intentionally." },
        { inlineData: { mimeType: "image/png", data: bodyReference.toString("base64") } },
      ] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "2:3" } },
    }),
  }, fetchImpl);
  const result = await providerJson(response);
  if (result?.promptFeedback?.blockReason || ["SAFETY", "IMAGE_SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST"].includes(result?.candidates?.[0]?.finishReason))
    throw new ProviderError("blocked");
  const output = result?.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.mimeType?.startsWith("image/"))?.inlineData?.data;
  if (!output) throw new ProviderError("no_image");
  if (typeof output !== "string" || output.length > 28_000_000) throw new ProviderError("invalid_image");
  try {
    const bytes = await sharp(Buffer.from(output, "base64"), { limitInputPixels: 25_000_000 }).png().toBuffer();
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    throw new ProviderError("invalid_image");
  }
}
