import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { customerPhotos } from "./helpers/customer-photos.js";
import { createApp, geminiPersonalize, standardAvatar } from "../server/app.js";

async function withServer(options, run) {
  const server = createApp(options).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
async function post(base, body, origin = base) {
  return fetch(`${base}/api/personalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ ...defaultRequest, ...body }),
  });
}
const faceBytes = await readFile(customerPhotos[1].face);
const bodyBytes = await readFile(customerPhotos[1].body);
const face = `data:image/jpeg;base64,${faceBytes.toString("base64")}`;
const bodyPhoto = `data:image/jpeg;base64,${bodyBytes.toString("base64")}`;
const measurements = { heightCm: 175, weightKg: 72 };
const defaultRequest = { consentScope: "face-and-body", measurements, body: bodyPhoto };

test("mobile preflight allows only native origins, and store access codes protect API calls", async () => {
  const token = "test-mobile-access-code-32-characters";
  let calls = 0;
  await withServer(
    {
      apiKey: "test-only",
      mobileToken: token,
      rateLimit: false,
      personalize: async () => {
        calls++;
        return face;
      },
    },
    async (base) => {
      for (const origin of ["capacitor://localhost", "https://localhost"]) {
        const preflight = await fetch(`${base}/api/personalize`, {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
          },
        });
        assert.equal(preflight.status, 204);
        assert.equal(
          preflight.headers.get("access-control-allow-origin"),
          origin,
        );
        const denied = await fetch(`${base}/api/health`, {
          headers: { Origin: origin, Authorization: "Bearer wrong" },
        });
        assert.equal(denied.status, 401);
        const health = await fetch(`${base}/api/health`, {
          headers: { Origin: origin, Authorization: `Bearer ${token}` },
        });
        assert.equal(health.status, 200);
        const generated = await fetch(`${base}/api/personalize`, {
          method: "POST",
          headers: {
            Origin: origin,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...defaultRequest, consent: true, profileId: "regular", face }),
        });
        assert.equal(generated.status, 200);
      }
      // Even a spoofed same-origin header cannot bypass token authentication.
      assert.equal(
        (await post(base, { consent: true, profileId: "regular", face }))
          .status,
        401,
      );
      const unknown = await fetch(`${base}/api/health`, {
        headers: {
          Origin: "https://untrusted.example",
          Authorization: `Bearer ${token}`,
        },
      });
      assert.equal(unknown.headers.get("access-control-allow-origin"), null);
      assert.equal(calls, 2);
    },
  );
});

test("native access remains disabled unless a strong mobile token is configured", async () => {
  assert.throws(() => createApp({ mobileToken: "short" }));
  await withServer({ apiKey: "test-only", mobileToken: "" }, async (base) => {
    const response = await fetch(`${base}/api/health`, {
      headers: { Origin: "capacitor://localhost" },
    });
    assert.equal(response.status, 403);
  });
});

test("health reports missing provider honestly without exposing credentials", async () => {
  await withServer({ apiKey: "" }, async (base) => {
    const result = await fetch(`${base}/api/health`);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal((await result.json()).personalizationAvailable, false);
    assert.equal(
      (await post(base, { consent: true, profileId: "regular", face })).status,
      503,
    );
  });
});
test("consent, compatible profile, and same-origin checks run before any provider call", async () => {
  let calls = 0;
  await withServer(
    {
      apiKey: "test-only",
      personalize: async () => {
        calls++;
      },
    },
    async (base) => {
      assert.equal(
        (await post(base, { consent: false, profileId: "regular", face }))
          .status,
        400,
      );
      assert.equal(
        (await post(base, { consent: true, profileId: "missing", face }))
          .status,
        400,
      );
      assert.equal(
        (
          await post(
            base,
            { consent: true, profileId: "regular", face },
            "https://untrusted.example",
          )
        ).status,
        403,
      );
      assert.equal(calls, 0);
    },
  );
});
test("rejects corrupt images without calling provider", async () => {
  let calls = 0;
  await withServer(
    {
      apiKey: "test-only",
      personalize: async () => {
        calls++;
      },
    },
    async (base) => {
      const response = await post(base, {
        consent: true,
        profileId: "regular",
        face: "data:image/png;base64,aGVsbG8=",
      });
      assert.equal(response.status, 400);
      assert.equal(calls, 0);
    },
  );
});
test("full-body photo, supported measurements and explicit two-photo consent are required before generation", async () => {
  let calls = 0;
  await withServer({ apiKey: "test-only", rateLimit: false, personalize: async () => { calls++; return face; } }, async base => {
    const valid = { consent: true, profileId: "regular", face };
    for (const invalid of [
      { body: undefined },
      { body: "data:image/jpeg;base64,aGVsbG8=" },
      { consentScope: "face-only" },
      { measurements: { heightCm: 0, weightKg: 72 } },
      { measurements: { heightCm: "175", weightKg: 72 } },
      { measurements: { heightCm: 175, weightKg: 201 } },
    ]) {
      const response = await post(base, { ...valid, ...invalid });
      assert.equal(response.status, 400);
    }
    assert.equal(calls, 0);
  });
});
test("passes both normalized customer photos, measurements and selected template for face/body/skin-tone review", async () => {
  let calls = 0;
  await withServer(
    {
      apiKey: "test-only",
      personalize: async ({ face: bytes, body, avatar, profileId, measurements: received }) => {
        assert.equal((await sharp(body).metadata()).format, "jpeg");
        assert.deepEqual(received, measurements);
        assert.equal(profileId, "broad");
        assert.equal((await sharp(body).metadata()).height, 1024);
        calls++;
        assert.equal((await sharp(bytes).metadata()).format, "jpeg");
        const meta = await sharp(avatar).metadata();
        assert.equal(meta.width, 384);
        assert.equal(meta.height, 942);
        return face;
      },
    },
    async (base) => {
      const response = await post(base, {
        consent: true,
        profileId: "broad",
        face,
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.profileId, "broad");
      assert.equal(result.needsReview, true);
      assert.equal(result.kind, "customer-avatar");
      assert.deepEqual(result.reviewChecks, ["face", "standard-body", "skin-tone"]);
      assert.equal(calls, 1);
      assert.equal(
        (await post(base, { consent: true, profileId: "broad", face })).status,
        429,
      );
    },
  );
});
test("provider failures are sanitized and never automatically retried", async () => {
  let calls = 0;
  await withServer(
    {
      apiKey: "test-only",
      personalize: async () => {
        calls++;
        throw new Error("secret diagnostic value");
      },
    },
    async (base) => {
      const response = await post(base, {
        consent: true,
        profileId: "regular",
        face,
      });
      assert.equal(response.status, 502);
      assert.equal(calls, 1);
      assert.ok(!(await response.text()).includes("secret diagnostic"));
    },
  );
});
test("Gemini adapter sends face, full-body photo and template in one skin-tone-matching request", async () => {
  let calls = 0;
  const avatar = await standardAvatar("regular");
  const result = await geminiPersonalize({
    face: faceBytes,
    body: bodyBytes,
    profileId: "regular",
    measurements,
    avatar,
    apiKey: "test-only",
    fetchImpl: async (url, options) => {
      calls++;
      assert.ok(url.startsWith("https://generativelanguage.googleapis.com/"));
      const body = JSON.parse(options.body);
      assert.equal(
        body.contents[0].parts.filter((p) => p.inlineData).length,
        3,
      );
      const parts = body.contents[0].parts;
      assert.equal(parts[1].inlineData.data, avatar.toString("base64"));
      assert.equal(parts[2].inlineData.data, faceBytes.toString("base64"));
      assert.equal(parts[3].inlineData.data, bodyBytes.toString("base64"));
      assert.match(parts[0].text, /MATCH THE CUSTOMER.S NATURAL SKIN TONE/);
      assert.match(parts[0].text, /arms, hands, legs and feet/);
      assert.match(parts[0].text, /selected standard body/);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: faceBytes.toString("base64"),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    },
  });
  assert.ok(result.startsWith("data:image/png;base64,"));
  assert.equal(calls, 1);
});
