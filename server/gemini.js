import sharp from "sharp";
import { profiles, recommendProfile } from "../src/profiles.js";
import { geminiAvatarPrompt } from "./avatar-prompt.js";
import { requireVisibleFace } from "./face-check.js";
import { geminiBodyReference } from "./gemini-reference.js";
import { ProviderError, providerRequest, providerJson } from "./provider-errors.js";

export const GEMINI_REFERENCE_VERSION = "customer-neck-v6";

// Gemini 2.5 Flash Image accepts three inputs. Keep the head and aligned
// template separate and put the two supporting photos side by side.
async function combineSupportingPhotos(body, hairstyle) {
  const width = 480;
  const height = 720;
  const gap = 12;
  const background = "#eeece9";
  const [left, right] = await Promise.all(
    [body, hairstyle].map((photo) =>
      sharp(photo).resize(width, height, { fit: "contain", background }).png().toBuffer(),
    ),
  );
  return sharp({ create: { width: width * 2 + gap, height, channels: 3, background } })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: width + gap, top: 0 },
    ])
    .png()
    .toBuffer();
}

export async function geminiPersonalize({
  face,
  body,
  avatar,
  profileId,
  measurements,
  hairstylePreset,
  hairstylePhoto,
  apiKey,
  model = "gemini-2.5-flash-image",
  fetchImpl = fetch,
  signal,
}) {
  signal?.throwIfAborted();
  if (!apiKey || !/^[a-zA-Z0-9.-]+$/.test(model)) throw new ProviderError("configuration");
  if (
    !profiles.some((profile) => profile.id === profileId) ||
    !face ||
    !body ||
    !avatar ||
    !recommendProfile(
      measurements?.heightCm,
      measurements?.weightKg,
      profiles.find((p) => p.id === profileId)?.body,
    )
  )
    throw new Error("Customer photos, measurements and a standard profile are required.");
  const bodyReference = await geminiBodyReference(avatar, profileId, face);
  const supportingPhoto = hairstylePhoto
    ? await combineSupportingPhotos(body, hairstylePhoto)
    : body;
  signal?.throwIfAborted();
  const response = await providerRequest(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.any([AbortSignal.timeout(180000), ...(signal ? [signal] : [])]),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: geminiAvatarPrompt(profileId, measurements, {
                  hairstylePreset,
                  hairstylePhoto,
                }),
              },
              {
                text:
                  hairstylePreset || hairstylePhoto
                    ? "Image 1 — CUSTOMER FACE. Preserve this face and glasses. Change only the requested scalp hairstyle."
                    : "Image 1 — CUSTOMER FACE. Preserve this face, hair and glasses.",
              },
              { inlineData: { mimeType: "image/jpeg", data: face.toString("base64") } },
              {
                text: hairstylePhoto
                  ? "Image 2 — two supporting photos. LEFT: customer full-body and complexion reference. RIGHT: hairstyle reference only."
                  : "Image 2 — CUSTOMER FULL-BODY PHOTO. Supporting customer complexion reference.",
              },
              {
                inlineData: {
                  mimeType: hairstylePhoto ? "image/png" : "image/jpeg",
                  data: supportingPhoto.toString("base64"),
                },
              },
              {
                text: "Image 3 — CUSTOMER FACE ALIGNED TO SELECTED BODY. Keep this visible customer face and head position. Blend the face, hair, neck and skin naturally; preserve body proportions.",
              },
              { inlineData: { mimeType: "image/png", data: bodyReference.toString("base64") } },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: "2:3" },
        },
      }),
    },
    fetchImpl,
  );
  const result = await providerJson(response);
  if (
    result?.promptFeedback?.blockReason ||
    ["SAFETY", "IMAGE_SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST"].includes(
      result?.candidates?.[0]?.finishReason,
    )
  )
    throw new ProviderError("blocked");
  const output = result?.candidates?.[0]?.content?.parts?.find((part) =>
    part.inlineData?.mimeType?.startsWith("image/"),
  )?.inlineData?.data;
  if (!output) throw new ProviderError("no_image");
  if (typeof output !== "string" || output.length > 28_000_000)
    throw new ProviderError("invalid_image");
  let bytes;
  try {
    bytes = await sharp(Buffer.from(output, "base64"), { limitInputPixels: 25_000_000 })
      .rotate()
      .png()
      .toBuffer();
  } catch {
    throw new ProviderError("invalid_image");
  }
  await requireVisibleFace(bytes);
  signal?.throwIfAborted();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}
