import express from "express";
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";
import { profiles, recommendProfile } from "../src/profiles.js";
import { providerErrorDetails } from "./provider-errors.js";
import { openaiPersonalize } from "./openai.js";
import { geminiPersonalize, GEMINI_REFERENCE_VERSION } from "./gemini.js";
import { providerConfig } from "./provider-config.js";
import { installAccountRoutes, accountUser } from "./accounts.js";
import { geminiTryOn, garmentTypes, normalizeAvatar, TRYON_CONTRACT } from "./gemini-tryon.js";
import { readProductLink, normalizeGarmentImage, LinkError } from "./product-link.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maxPhotoBytes = 5 * 1024 * 1024;

export async function normalizePhoto(dataUrl, kind = "face") {
  if (typeof dataUrl !== "string" || dataUrl.length > maxPhotoBytes * 1.4)
    throw new Error(`Use a JPEG, PNG, or WebP ${kind} photo under 5 MB.`);
  const match =
    /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error(`Use a valid JPEG, PNG, or WebP ${kind} photo.`);
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > maxPhotoBytes)
    throw new Error(`The ${kind} photo is too large.`);
  const image = sharp(bytes, { limitInputPixels: 25_000_000, animated: false });
  let metadata;
  try {
    metadata = await image.metadata();
  } catch {
    throw new Error(`The ${kind} photo could not be decoded.`);
  }
  if (
    !["jpeg", "png", "webp"].includes(metadata.format) ||
    !metadata.width ||
    !metadata.height ||
    metadata.width < 128 ||
    metadata.height < 128
  )
    throw new Error(`Use a ${kind} photo at least 128 × 128 pixels.`);
  try {
    return await image
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    throw new Error(`The ${kind} photo could not be decoded.`);
  }
}

export async function standardAvatar(profileId) {
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error("Choose an available body profile.");
  const source = sharp(path.join(root, "public/avatar-library.png"));
  const metadata = await source.metadata();
  const panelWidth = Math.floor(metadata.width / 4);
  return source
    .extract({
      left: profile.index * panelWidth,
      top: 0,
      width: panelWidth,
      height: Math.round(metadata.height * 0.92),
    })
    .png()
    .toBuffer();
}

export function createApp({
  provider = providerConfig().provider,
  apiKey = providerConfig(provider).apiKey,
  model = providerConfig(provider).model,
  quality = process.env.TRYON_OPENAI_QUALITY || "low",
  personalize = provider === "gemini" ? geminiPersonalize : openaiPersonalize,
  production = false,
  rateLimit = true,
  mobileToken = process.env.TRYON_MOBILE_TOKEN || "",
  accessMode = process.env.TRYON_ACCESS_MODE || "auto",
  trustProxy = false,
  accountStore = null,
  allowSignup = true,
  tryOn = geminiTryOn,
  productLink = readProductLink,
} = {}) {
  const providerLabel = providerConfig(provider).label;
  if (!["auto", "protected", "public"].includes(accessMode))
    throw new Error("TRYON_ACCESS_MODE must be auto, protected, or public.");
  // Public mode is an explicit operator choice for anonymous browser generation.
  if (accessMode === "public") mobileToken = "";
  if (accessMode === "protected" && !mobileToken)
    throw new Error("Configure TRYON_MOBILE_TOKEN or explicitly select public access mode.");
  if (mobileToken && mobileToken.length < 24)
    throw new Error("TRYON_MOBILE_TOKEN must be at least 24 characters.");
  const app = express();
  if (trustProxy !== false && trustProxy !== 1)
    throw new Error("Only the direct connection or one trusted reverse proxy is supported.");
  app.set("trust proxy", trustProxy);
  app.disable("x-powered-by");
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  const nativeOrigins = new Set(["capacitor://localhost", "https://localhost"]);
  app.use("/api", (req, res, next) => {
    const origin = req.get("origin");
    if (origin && nativeOrigins.has(origin)) {
      if (!mobileToken)
        return res
          .status(403)
          .json({
            error: "This studio is not configured for mobile connections.",
          });
      res.set("Access-Control-Allow-Origin", origin);
      res.vary("Origin");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      if (req.method === "OPTIONS") return res.sendStatus(204);
    }
    // When mobile access is enabled, protect every API route, including same-origin
    // calls. CORS is not authentication and must not allow a header-spoofing bypass.
    if (mobileToken) {
      const supplied = req.get("authorization") || "";
      const digest = (value) => createHash("sha256").update(value).digest();
      if (!timingSafeEqual(digest(supplied), digest(`Bearer ${mobileToken}`))) {
        return res
          .status(401)
          .json({ error: "A valid store access code is required." });
      }
    }
    next();
  });
  // Two <=5 MB photos, base64-encoded, plus small metadata. Each is checked below.
  app.use("/api/account", express.json({ limit: "4kb" }));
  app.use(express.json({ limit: "15mb" }));
  installAccountRoutes(app, accountStore, { production, allowSignup });
  app.get("/api/health", (_req, res) =>
    res.json({
      status: "ok",
      personalizationAvailable: Boolean(apiKey),
      provider,
      generationRevision: provider === "gemini" ? GEMINI_REFERENCE_VERSION : "template-first-v1",
      personalizationContract: "customer-avatar-v4",
      storage: accountStore ? "account" : "ephemeral",
      accountsAvailable: Boolean(accountStore),
      profileCount: profiles.length,
      tryOnAvailable: provider === "gemini" && Boolean(apiKey),
      tryOnContract: TRYON_CONTRACT,
      garmentTypes: Object.keys(garmentTypes),
    }),
  );

  let inFlight = 0;
  const attempts = new Map();
  app.post("/api/personalize", async (req, res) => {
    req.body ||= {};
    const origin = req.get("origin");
    const owner = accountUser(accountStore, req);
    if (accountStore && !owner) return res.status(401).json({ error: "Sign in to the store account before generating an avatar.", code: "account_required" });
    if (accountStore && req.body.accountStorageConsent !== true) return res.status(400).json({ error: "Confirm customer agreement to save the generated avatar in the store account." });
    try {
      if (
        !origin ||
        (!(mobileToken && nativeOrigins.has(origin)) &&
          new URL(origin).host !== req.get("host"))
      )
        return res
          .status(403)
          .json({ error: "Open this workflow from the Avatar Studio app." });
    } catch {
      return res.status(403).json({ error: "Invalid request origin." });
    }
    if (req.body?.consent !== true || req.body?.consentScope !== "face-and-body" || req.body?.consentProvider !== provider)
      return res.status(400).json({
        error: `Customer consent to send both photos and measurements to ${providerLabel} is required. Refresh or update the app before generating.`,
      });
    if (!profiles.some((p) => p.id === req.body?.profileId))
      return res
        .status(400)
        .json({ error: "Choose an available body profile." });
    if (!recommendProfile(req.body?.measurements?.heightCm, req.body?.measurements?.weightKg))
      return res.status(400).json({ error: "Enter a height from 140–210 cm and weight from 35–200 kg." });
    if (!apiKey)
      return res.status(503).json({
        error:
          "Customer avatar generation is not connected. Configure the studio before generating a customer avatar.",
      });
    if (inFlight >= 2)
      return res.status(429).json({
        error:
          "The studio is processing another avatar. Please try again shortly.",
      });
    const now = Date.now();
    for (const [key, entry] of attempts)
      if (now - entry.started > 3600000) attempts.delete(key);
    const previous = attempts.get(req.ip);
    if (
      rateLimit &&
      previous &&
      (now - previous.last < 15000 || previous.count >= 20)
    )
      return res.status(429).json({
        error:
          "Please wait before generating again. This pilot allows up to 20 attempts per hour.",
      });
    let face, body, avatar;
    try {
      face = await normalizePhoto(req.body.face);
      body = await normalizePhoto(req.body.body, "full-body");
      avatar = await standardAvatar(req.body.profileId);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    // Recheck after decoding: multiple requests may have arrived during asynchronous validation.
    const latest = attempts.get(req.ip);
    if (
      inFlight >= 2 ||
      (rateLimit &&
        latest &&
        (Date.now() - latest.last < 15000 || latest.count >= 20))
    )
      return res
        .status(429)
        .json({ error: "Please wait before generating again." });
    attempts.set(req.ip, {
      started: latest?.started || now,
      last: Date.now(),
      count: (latest?.count || 0) + 1,
    });
    inFlight++;
    try {
      const image = await personalize({ face, body, avatar, profileId: req.body.profileId, measurements: req.body.measurements, apiKey, model, quality });
      let accountSaved = false;
      if (accountStore) {
        try {
          await accountStore.save(owner, { image, name: typeof req.body.avatarName === "string" && req.body.avatarName.trim() ? req.body.avatarName.trim().slice(0,60) : "Customer avatar", profileId: req.body.profileId, heightCm: req.body.measurements.heightCm, weightKg: req.body.measurements.weightKg, source: "generated" });
          accountSaved = true;
        } catch {
          // Preserve the paid result for manual saving/download. Never retry AI
          // generation because a database write failed.
          console.error(JSON.stringify({event:"avatar_account_save_failed"}));
        }
      }
      res.json({ image, provider, profileId: req.body.profileId, kind: "customer-avatar", needsReview: true, reviewChecks: ["face", "standard-body", "skin-tone"], ...(accountStore ? {accountSaved, accountSaveError: accountSaved ? null : "Avatar created, but saving to your account failed. Download it now or review and save it again; do not regenerate."} : {}) });
    } catch (error) {
      const failure = providerErrorDetails(error, provider);
      console.error(JSON.stringify({ event: "avatar_provider_failure", provider, code: failure.code, providerStatus: failure.providerStatus }));
      res.status(failure.code === "face_input" ? 400 : 502).json({
        error: failure.message,
        code: failure.code,
      });
    } finally {
      inFlight--;
    }
  });
  const sameStudio = (req) => {
    const origin = req.get("origin");
    try {
      return Boolean(origin) && ((mobileToken && nativeOrigins.has(origin)) || new URL(origin).host === req.get("host"));
    } catch {
      return false;
    }
  };

  // Product links: no AI call, but outbound fetches are rate limited per client.
  const linkAttempts = new Map();
  let linksInFlight = 0;
  app.post("/api/product-link", async (req, res) => {
    req.body ||= {};
    if (accountStore && !accountUser(accountStore, req)) return res.status(401).json({ error: "Sign in to the store account before reading product links.", code: "account_required" });
    if (!sameStudio(req)) return res.status(403).json({ error: "Open this workflow from the Avatar Studio app." });
    const now = Date.now();
    for (const [key, entry] of linkAttempts) if (now - entry.started > 3600000) linkAttempts.delete(key);
    const entry = linkAttempts.get(req.ip) || { started: now, last: 0, count: 0 };
    if (rateLimit && (now - entry.last < 2000 || entry.count >= 60))
      return res.status(429).json({ error: "Please wait a moment before reading another link." });
    if (linksInFlight >= 4) return res.status(429).json({ error: "The studio is reading other links. Please try again shortly." });
    linkAttempts.set(req.ip, { started: entry.started, last: now, count: entry.count + 1 });
    linksInFlight++;
    try {
      res.json(await productLink(req.body.url));
    } catch (error) {
      const failure = error instanceof LinkError ? error : new LinkError("unknown");
      console.error(JSON.stringify({ event: "product_link_failure", code: failure.code }));
      res.status(["invalid_url", "blocked_address"].includes(failure.code) ? 400 : failure.code === "no_images" ? 422 : 502)
        .json({ error: failure.message, code: failure.code });
    } finally {
      linksInFlight--;
    }
  });

  // Garment try-on: one paid provider call, sharing the generation limits.
  app.post("/api/tryon", async (req, res) => {
    req.body ||= {};
    if (accountStore && !accountUser(accountStore, req)) return res.status(401).json({ error: "Sign in to the store account before trying on clothes.", code: "account_required" });
    if (!sameStudio(req)) return res.status(403).json({ error: "Open this workflow from the Avatar Studio app." });
    if (req.body.consent !== true || req.body.consentScope !== "avatar-and-garment" || req.body.consentProvider !== provider)
      return res.status(400).json({ error: `Customer consent to send the avatar and garment image to ${providerLabel} is required.` });
    if (!Object.hasOwn(garmentTypes, req.body.garmentType))
      return res.status(400).json({ error: "Choose what to put on: shirt, T-shirt, trousers, jeans, shoes or another listed type." });
    if (provider !== "gemini" || !apiKey)
      return res.status(503).json({ error: "Clothing try-on from product images needs the Gemini provider to be configured on the studio." });
    if (inFlight >= 2) return res.status(429).json({ error: "The studio is processing another image. Please try again shortly." });
    const now = Date.now();
    for (const [key, entry] of attempts) if (now - entry.started > 3600000) attempts.delete(key);
    const previous = attempts.get(req.ip);
    if (rateLimit && previous && (now - previous.last < 15000 || previous.count >= 20))
      return res.status(429).json({ error: "Please wait before generating again. This pilot allows up to 20 AI attempts per hour." });
    let avatar, garment;
    try {
      avatar = await normalizeAvatar(req.body.avatar);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    try {
      const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(typeof req.body.garment === "string" && req.body.garment.length < maxPhotoBytes * 1.4 ? req.body.garment : "");
      if (!match) throw new Error();
      garment = await normalizeGarmentImage(Buffer.from(match[2], "base64"));
    } catch {
      return res.status(400).json({ error: "Use a JPEG, PNG or WebP garment image under 5 MB and at least 160 × 160 pixels." });
    }
    const latest = attempts.get(req.ip);
    if (inFlight >= 2 || (rateLimit && latest && (Date.now() - latest.last < 15000 || latest.count >= 20)))
      return res.status(429).json({ error: "Please wait before generating again." });
    attempts.set(req.ip, { started: latest?.started || now, last: Date.now(), count: (latest?.count || 0) + 1 });
    inFlight++;
    try {
      const image = await tryOn({ avatar, garment, garmentType: req.body.garmentType, title: req.body.title, apiKey, model });
      res.json({ image, provider, kind: "garment-tryon", garmentType: req.body.garmentType, needsReview: true });
    } catch (error) {
      const failure = providerErrorDetails(error, provider);
      console.error(JSON.stringify({ event: "tryon_provider_failure", provider, code: failure.code, providerStatus: failure.providerStatus }));
      res.status(502).json({
        error: failure.code === "missing_face" ? "The try-on image lost the customer's face and was rejected. A provider charge may still apply; no automatic retry was made." : failure.message.replace("Customer avatar generation", "Clothing try-on").replace("No customer avatar was created", "The avatar is unchanged"),
        code: failure.code,
      });
    } finally {
      inFlight--;
    }
  });

  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  if (production) {
    app.use(express.static(path.join(root, "dist")));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(path.join(root, "dist/index.html")),
    );
  }
  app.use((error, _req, res, _next) => {
    res.status(error.type === "entity.too.large" ? 413 : 400).json({
      error:
        error.type === "entity.too.large"
          ? "The upload is too large."
          : "The request could not be read.",
    });
  });
  return app;
}
