// Run inside the app container; credentials are read from its environment and
// never printed. This checks routing/auth/configuration without a paid AI call.
const origin = "http://127.0.0.1:3001";
const token = process.env.TRYON_MOBILE_TOKEN;
if (!token || token.length < 24 || !process.env.TRYON_GEMINI_API_KEY) {
  throw new Error("Configure a Gemini key and a store access code of at least 24 characters.");
}
const anonymous = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5000) });
if (anonymous.status !== 401) throw new Error("API must reject unauthenticated requests.");
const response = await fetch(`${origin}/api/health`, {
  signal: AbortSignal.timeout(5000),
  headers: { Origin: "https://localhost", Authorization: `Bearer ${token}` },
});
const health = await response.json();
if (!response.ok || !health.personalizationAvailable || health.personalizationContract !== "customer-avatar-v2") {
  throw new Error("Generation configuration or server version is not ready.");
}
if (response.headers.get("access-control-allow-origin") !== "https://localhost") {
  throw new Error("Android origin is not enabled.");
}
console.log("Backend authentication, Android CORS and generation configuration passed. No AI call was made; key validity and HTTPS still need verification.");
