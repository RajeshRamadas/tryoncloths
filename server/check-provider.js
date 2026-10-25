import { checkGeminiAccess, providerErrorDetails } from "./provider-errors.js";

try {
  const result = await checkGeminiAccess({ apiKey: process.env.TRYON_GEMINI_API_KEY, model: process.env.TRYON_GEMINI_MODEL || "gemini-2.5-flash-image" });
  console.log(JSON.stringify(result));
  console.log("Model metadata check completed. No photos were sent and no image was generated. This does not verify image-generation quota, billing or output quality.");
} catch (error) {
  console.error(JSON.stringify(providerErrorDetails(error)));
  process.exitCode = 1;
}
