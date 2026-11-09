import { turnstileClient } from "./turnstile-client.js";

const endpoint = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const unavailable = () => new Error("Verification service is unavailable.");
const validKey = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{20,200}$/.test(value);
const testKey = (value) => /^[123]x0{10,}/.test(value);

async function readJson(response) {
  if (!response.ok || Number(response.headers.get("content-length") || 0) > 16384)
    throw unavailable();
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  let length = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16384) throw unavailable();
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Server-only key; the browser receives only the public site key. Each explicit
// action makes one verification request, without retry or optional raw IP data.
export function createTurnstile({ siteKey, secretKey, fetchImpl = fetch, production = true } = {}) {
  if (
    !validKey(siteKey) ||
    !validKey(secretKey) ||
    (production && (testKey(siteKey) || testKey(secretKey)))
  )
    throw new Error("Configure real Turnstile site and secret keys.");
  return {
    captcha: {
      id: "cloudflare-turnstile",
      async verify({ token, action, hostname, signal }) {
        if (
          typeof token !== "string" ||
          !token ||
          token.length > 2048 ||
          !["avatar", "tryon"].includes(action) ||
          typeof hostname !== "string" ||
          !hostname
        )
          return { success: false };
        const combined = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]);
        combined.throwIfAborted();
        try {
          const response = await fetchImpl(endpoint, {
            method: "POST",
            redirect: "error",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: secretKey, response: token }),
            signal: combined,
          });
          const data = await readJson(response);
          combined.throwIfAborted();
          return {
            success:
              data?.success === true &&
              data.action === action &&
              data.hostname === hostname &&
              Number.isFinite(Date.parse(data.challenge_ts)),
            action: data?.action,
            hostname: data?.hostname,
            issuedAt: data?.challenge_ts,
          };
        } catch {
          combined.throwIfAborted();
          throw unavailable();
        }
      },
    },
    verificationClient: {
      id: "cloudflare-turnstile",
      script: `(${turnstileClient.toString()})(${JSON.stringify(siteKey)});`,
      scriptOrigins: ["https://challenges.cloudflare.com"],
      connectOrigins: ["https://challenges.cloudflare.com"],
      frameOrigins: ["https://challenges.cloudflare.com"],
    },
  };
}
