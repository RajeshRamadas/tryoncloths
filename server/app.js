import express from "express";
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { profiles } from "../src/profiles.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maxPhotoBytes = 5 * 1024 * 1024;

export async function normalizeFace(dataUrl) {
  if (typeof dataUrl !== "string" || dataUrl.length > maxPhotoBytes * 1.4)
    throw new Error("Use a JPEG, PNG, or WebP face photo under 5 MB.");
  const match =
    /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("Use a valid JPEG, PNG, or WebP face photo.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > maxPhotoBytes)
    throw new Error("The face photo is too large.");
  const image = sharp(bytes, { limitInputPixels: 25_000_000, animated: false });
  let metadata;
  try {
    metadata = await image.metadata();
  } catch {
    throw new Error("The face photo could not be decoded.");
  }
  if (
    !["jpeg", "png", "webp"].includes(metadata.format) ||
    !metadata.width ||
    !metadata.height ||
    metadata.width < 128 ||
    metadata.height < 128
  )
    throw new Error("Use a face photo at least 128 × 128 pixels.");
  try {
    return await image
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    throw new Error("The face photo could not be decoded.");
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

export async function geminiPersonalize({
  face,
  avatar,
  apiKey,
  model = "gemini-2.5-flash-image",
  fetchImpl = fetch,
}) {
  if (!/^[a-zA-Z0-9.-]+$/.test(model))
    throw new Error("Invalid model configuration.");
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Create one full-body avatar image for this consenting adult customer. Image 1 is the standard body reference. Image 2 is the customer face reference. Adapt only the face and hair area of image 1 to resemble image 2, blending the neck naturally. Preserve the body proportions, clothes, pose, camera, background and head-to-toe framing of image 1. Do not use body shape or clothing from image 2. No text, no collage, no extra people. Return a single full-body image. This is an approximate visual avatar, not a measurement or exact identity guarantee.",
              },
              {
                inlineData: {
                  mimeType: "image/png",
                  data: avatar.toString("base64"),
                },
              },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: face.toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    },
  );
  if (!response.ok)
    throw new Error(
      "The personalization service could not complete this request. Your standard avatar is still available.",
    );
  const result = await response.json();
  const output = result.candidates?.[0]?.content?.parts?.find((p) =>
    p.inlineData?.mimeType?.startsWith("image/"),
  )?.inlineData;
  if (!output?.data || output.data.length > 28_000_000)
    throw new Error(
      "No usable avatar was returned. Your standard avatar is still available.",
    );
  const bytes = await sharp(Buffer.from(output.data, "base64"), {
    limitInputPixels: 25_000_000,
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

export function createApp({
  apiKey = process.env.TRYON_GEMINI_API_KEY,
  model = process.env.TRYON_GEMINI_MODEL || "gemini-2.5-flash-image",
  personalize = geminiPersonalize,
  production = false,
  rateLimit = true,
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(express.json({ limit: "8mb" }));
  app.get("/api/health", (_req, res) =>
    res.json({
      status: "ok",
      personalizationAvailable: Boolean(apiKey),
      storage: "ephemeral",
      profileCount: profiles.length,
    }),
  );

  let inFlight = 0;
  const attempts = new Map();
  app.post("/api/personalize", async (req, res) => {
    const origin = req.get("origin");
    try {
      if (!origin || new URL(origin).host !== req.get("host"))
        return res
          .status(403)
          .json({ error: "Open this workflow from the Avatar Studio app." });
    } catch {
      return res.status(403).json({ error: "Invalid request origin." });
    }
    if (req.body?.consent !== true)
      return res
        .status(400)
        .json({
          error: "Customer consent is required before face personalization.",
        });
    if (!profiles.some((p) => p.id === req.body?.profileId))
      return res
        .status(400)
        .json({ error: "Choose an available body profile." });
    if (!apiKey)
      return res
        .status(503)
        .json({
          error:
            "Face personalization is not connected. Continue with a standard sample avatar.",
        });
    if (inFlight >= 2)
      return res
        .status(429)
        .json({
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
      return res
        .status(429)
        .json({
          error:
            "Please wait before generating again. This pilot allows up to 20 attempts per hour.",
        });
    let face, avatar;
    try {
      face = await normalizeFace(req.body.face);
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
      const image = await personalize({ face, avatar, apiKey, model });
      res.json({ image, profileId: req.body.profileId, needsReview: true });
    } catch {
      res
        .status(502)
        .json({
          error:
            "Face personalization could not be completed. Your standard avatar is still available. A timed-out request may still incur a provider charge; retries are never automatic.",
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
    res
      .status(error.type === "entity.too.large" ? 413 : 400)
      .json({
        error:
          error.type === "entity.too.large"
            ? "The upload is too large."
            : "The request could not be read.",
      });
  });
  return app;
}
