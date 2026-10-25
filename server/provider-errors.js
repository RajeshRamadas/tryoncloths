const messages = {
  configuration: "The server's Gemini key or image-model configuration is missing or invalid.",
  credentials: "Gemini rejected the server's API key or access permissions. Check the key, API restrictions and project access.",
  model: "The configured Gemini model was not found or is unavailable to this project. Check TRYON_GEMINI_MODEL.",
  quota: "Gemini reported a quota or rate limit. Check the Google project's billing and model quota; this is separate from the app's attempt limit.",
  request: "Gemini rejected the generation request. Check the image model, its supported inputs and the project's billing or regional requirements.",
  timeout: "Gemini did not finish before the request timed out. A timed-out request may still incur a provider charge.",
  network: "The server could not connect to Gemini. Check its internet connection and access to generativelanguage.googleapis.com.",
  unavailable: "Gemini is temporarily unavailable. Try again later.",
  blocked: "Gemini blocked this generation. No customer avatar was returned.",
  no_image: "Gemini returned no image. Check that the configured model supports image output; a provider charge may still apply.",
  invalid_image: "Gemini returned an unusable image. No customer avatar was created; a provider charge may still apply.",
  response: "Gemini returned an unreadable response. No customer avatar was created.",
  unknown: "Customer avatar generation could not be completed. No new customer avatar was created. A timed-out request may still incur a provider charge; retries are never automatic.",
};

export class ProviderError extends Error {
  constructor(code, status = null) {
    const safeCode = Object.hasOwn(messages, code) ? code : "unknown";
    super(messages[safeCode]);
    this.code = safeCode;
    this.providerStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  }
}

export function providerErrorDetails(error) {
  // Never expose arbitrary provider bodies, SDK messages, keys, or customer data.
  const code = error instanceof ProviderError && Object.hasOwn(messages, error.code) ? error.code : "unknown";
  return { code, message: messages[code], providerStatus: error instanceof ProviderError ? error.providerStatus : null };
}

export async function providerRequest(url, options, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (error) {
    throw new ProviderError(["TimeoutError", "AbortError"].includes(error?.name) ? "timeout" : "network");
  }
  if (response.ok) return response;
  const status = response.status;
  let code = status === 401 || status === 403 ? "credentials"
    : status === 404 ? "model"
    : status === 429 ? "quota"
    : status === 408 || status === 504 ? "timeout"
    : status >= 500 ? "unavailable" : "request";
  if (status === 400) {
    const body = await response.json().catch(() => null);
    if (body?.error?.details?.some(detail => ["API_KEY_INVALID", "API_KEY_EXPIRED"].includes(detail.reason))) code = "credentials";
  }
  throw new ProviderError(code, status);
}

export async function providerJson(response) {
  try {
    return await response.json();
  } catch (error) {
    throw new ProviderError(["TimeoutError", "AbortError"].includes(error?.name) ? "timeout" : "response");
  }
}

export async function checkGeminiAccess({ apiKey, model = "gemini-2.5-flash-image", fetchImpl = fetch }) {
  if (!apiKey || !/^[a-zA-Z0-9.-]+$/.test(model)) throw new ProviderError("configuration");
  const response = await providerRequest(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
    method: "GET",
    headers: { "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(15000),
  }, fetchImpl);
  const data = await providerJson(response);
  return { model, providerStatus: response.status, supportsGenerateContent: data?.supportedGenerationMethods?.includes("generateContent") === true };
}
