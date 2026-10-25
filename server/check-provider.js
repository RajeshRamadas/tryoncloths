import { checkOpenAIAccess, providerErrorDetails } from "./provider-errors.js";

try {
  const result = await checkOpenAIAccess({ apiKey: process.env.OPENAI_API_KEY, model: process.env.TRYON_OPENAI_MODEL || "gpt-image-1.5" });
  console.log(JSON.stringify(result));
  console.log("Model metadata check completed. No photos were sent and no image was generated. This does not verify image-generation quota, billing or output quality.");
} catch (error) {
  console.error(JSON.stringify(providerErrorDetails(error)));
  process.exitCode = 1;
}
