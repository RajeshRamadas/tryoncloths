import sharp from "sharp";
import { profiles, recommendProfile } from "../src/profiles.js";
import { avatarPrompt } from "./avatar-prompt.js";
import { requireVisibleFace } from "./face-check.js";
import { ProviderError, providerRequest, providerJson } from "./provider-errors.js";

export async function openaiPersonalize({
  face, body, avatar, profileId, measurements, apiKey,
  model = "gpt-image-1.5", quality = "low", fetchImpl = fetch,
}) {
  if (!apiKey || !/^(gpt-image-[a-zA-Z0-9.-]+|chatgpt-image-latest)$/.test(model) || !["low", "medium", "high"].includes(quality))
    throw new ProviderError("configuration");
  if (!profiles.some(profile => profile.id === profileId) || !face || !body || !avatar ||
      !recommendProfile(measurements?.heightCm, measurements?.weightKg))
    throw new Error("Customer photos, measurements and a standard profile are required.");

  const form = new FormData();
  form.set("model", model);
  form.set("prompt", avatarPrompt(profileId, measurements));
  form.set("n", "1");
  form.set("size", "1024x1536");
  form.set("quality", quality);
  form.set("output_format", "png");
  // High input fidelity helps preserve faces; only these models support it.
  if (["gpt-image-1", "gpt-image-1.5"].includes(model)) form.set("input_fidelity", "high");
  form.append("image[]", new Blob([avatar], { type: "image/png" }), "standard-body.png");
  form.append("image[]", new Blob([face], { type: "image/jpeg" }), "customer-face.jpg");
  form.append("image[]", new Blob([body], { type: "image/jpeg" }), "customer-body.jpg");

  const response = await providerRequest("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(180000),
  }, fetchImpl);
  const result = await providerJson(response);
  const output = result?.data?.[0]?.b64_json;
  if (!output) throw new ProviderError("no_image");
  if (typeof output !== "string" || output.length > 28_000_000) throw new ProviderError("invalid_image");
  let bytes;
  try {
    bytes = await sharp(Buffer.from(output, "base64"), { limitInputPixels: 25_000_000 }).rotate().png().toBuffer();
  } catch {
    throw new ProviderError("invalid_image");
  }
  await requireVisibleFace(bytes);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}
