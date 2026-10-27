// Run inside the app container; credentials are read from its environment and
// never printed. This checks routing/auth/configuration without a paid AI call.
const origin = "http://127.0.0.1:3001";
const token = process.env.TRYON_MOBILE_TOKEN;
const publicAccess = process.env.TRYON_ACCESS_MODE === "public";
const provider = process.env.TRYON_PROVIDER || "gemini";
if (!(provider === "gemini" ? process.env.TRYON_GEMINI_API_KEY : process.env.OPENAI_API_KEY)) throw new Error(`Configure the ${provider} API key on the server.`);
if (!publicAccess && (!token || token.length < 24))
  throw new Error("Configure a store access code of at least 24 characters for protected access.");
const anonymous = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5000) });
if (anonymous.status !== (publicAccess ? 200 : 401)) throw new Error("API access does not match the configured access mode.");
const response = await fetch(`${origin}/api/health`, {
  signal: AbortSignal.timeout(5000),
  headers: publicAccess ? {} : { Origin: "https://localhost", Authorization: `Bearer ${token}` },
});
const health = await response.json();
if (!response.ok || !health.personalizationAvailable || health.provider !== provider || health.personalizationContract !== "customer-avatar-v4") {
  throw new Error("Generation configuration or server version is not ready.");
}
if (provider === "gemini" && health.generationRevision !== "customer-first-v4")
  throw new Error("Update the backend to the customer-first Gemini reference pipeline.");
if (!publicAccess && response.headers.get("access-control-allow-origin") !== "https://localhost") {
  throw new Error("Android origin is not enabled.");
}
console.log(publicAccess
  ? "Public browser access and generation configuration passed. Anyone can request generation against your quota. No AI call was made; key validity and HTTPS still need verification."
  : "Backend authentication, Android CORS and generation configuration passed. No AI call was made; key validity and HTTPS still need verification.");
