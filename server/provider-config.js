export function providerConfig(provider = process.env.TRYON_PROVIDER || "gemini") {
  if (!["gemini", "openai"].includes(provider)) throw new Error("TRYON_PROVIDER must be gemini or openai.");
  return provider === "gemini"
    ? { provider, label: "Google Gemini", apiKey: process.env.TRYON_GEMINI_API_KEY, model: process.env.TRYON_GEMINI_MODEL || "gemini-2.5-flash-image" }
    : { provider, label: "OpenAI", apiKey: process.env.OPENAI_API_KEY, model: process.env.TRYON_OPENAI_MODEL || "gpt-image-1.5" };
}
