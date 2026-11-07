// Copy outside the repository to the reviewed, read-only configuration mount.
// Secrets belong in server environment variables. This module is trusted code:
// no logging, network calls or image processing during import. The default below
// intentionally cannot enable generation. Never use permissive test adapters.
export default {
  // Fill the complete legally reviewed C16.4 disclosure, including actual
  // verification/moderation processing and retention, with a stable revision.
  disclosure: null,
  // Select the reviewed optional TRYON_SHOPPER_MODERATION=gemini adapter,
  // or import a reviewed custom safety adapter implementing
  // {id, async check({images,stage,policy,signal}) -> {allowed,policy}}.
  // Keep this null when selecting the built-in adapter; do not configure both.
  // Generic face presence or a provider's default safety filter is insufficient.
  moderation: null,
  // Optional custom captcha + verificationClient can be exported here instead
  // of selecting TRYON_SHOPPER_CAPTCHA=turnstile. Do not configure both.
};
