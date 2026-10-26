import { checkGeminiAccess, checkOpenAIAccess, providerErrorDetails } from "./provider-errors.js";
import { providerConfig } from "./provider-config.js";

const config = providerConfig();

try {
  const result = await (config.provider === "gemini" ? checkGeminiAccess : checkOpenAIAccess)(config);
  console.log(JSON.stringify({ provider: config.provider, ...result }));
  console.log("Model metadata check completed. No photos were sent and no image was generated. This does not verify image-generation quota, billing or output quality.");
} catch (error) {
  console.error(JSON.stringify(providerErrorDetails(error, config.provider)));
  process.exitCode = 1;
}
