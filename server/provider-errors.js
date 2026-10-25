const messages = {
  configuration: "The server's OpenAI key or image-model configuration is missing or invalid.",
  credentials: "OpenAI rejected the server's API key or access permissions. Check the key, project permissions and any required organization verification for image models.",
  model: "The configured OpenAI model was not found or is unavailable to this project. Check TRYON_OPENAI_MODEL.",
  quota: "OpenAI reported a quota or rate limit. Check the OpenAI project's billing and model quota; this is separate from the app's attempt limit.",
  request: "OpenAI rejected the generation request. Check the image model, its supported inputs and the project's billing or regional requirements.",
  timeout: "OpenAI did not finish before the request timed out. A timed-out request may still incur a provider charge.",
  network: "The server could not connect to OpenAI. Check its internet connection and access to api.openai.com.",
  unavailable: "OpenAI is temporarily unavailable. Try again later.",
  blocked: "OpenAI blocked this generation. No customer avatar was returned.",
  no_image: "OpenAI returned no image. Check that the configured model supports image output; a provider charge may still apply.",
  invalid_image: "OpenAI returned an unusable image. No customer avatar was created; a provider charge may still apply.",
  response: "OpenAI returned an unreadable response. No customer avatar was created.",
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
  const body = await response.json().catch(() => null);
  const providerCode = body?.error?.code || body?.error?.type;
  if (providerCode === "invalid_api_key") code = "credentials";
  else if (providerCode === "model_not_found") code = "model";
  else if (["insufficient_quota", "billing_hard_limit_reached", "billing_not_active"].includes(providerCode)) code = "quota";
  else if (providerCode === "content_policy_violation") code = "blocked";
  throw new ProviderError(code, status);
}

export async function providerJson(response) {
  try {
    return await response.json();
  } catch (error) {
    throw new ProviderError(["TimeoutError", "AbortError"].includes(error?.name) ? "timeout" : "response");
  }
}

export async function checkOpenAIAccess({ apiKey, model = "gpt-image-1.5", fetchImpl = fetch }) {
  if (!apiKey || !/^(gpt-image-[a-zA-Z0-9.-]+|chatgpt-image-latest)$/.test(model)) throw new ProviderError("configuration");
  const response = await providerRequest(`https://api.openai.com/v1/models/${model}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15000),
  }, fetchImpl);
  const data = await providerJson(response);
  if (data?.object !== "model" || typeof data?.id !== "string") throw new ProviderError("response");
  return { model, providerStatus: response.status, modelAccessible: true };
}
