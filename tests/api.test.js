import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
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
    body: JSON.stringify(body),
  });
}
const faceBytes = await sharp({
  create: { width: 150, height: 150, channels: 3, background: "#c8bca8" },
})
  .png()
  .toBuffer();
const face = `data:image/png;base64,${faceBytes.toString("base64")}`;

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
test("passes normalized face and selected body to the provider, then requires review", async () => {
  let calls = 0;
  await withServer(
    {
      apiKey: "test-only",
      personalize: async ({ face: bytes, avatar }) => {
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
test("Gemini adapter sends face and avatar once and decodes returned image", async () => {
  let calls = 0;
  const avatar = await standardAvatar("regular");
  const result = await geminiPersonalize({
    face: faceBytes,
    avatar,
    apiKey: "test-only",
    fetchImpl: async (url, options) => {
      calls++;
      assert.ok(url.startsWith("https://generativelanguage.googleapis.com/"));
      const body = JSON.parse(options.body);
      assert.equal(
        body.contents[0].parts.filter((p) => p.inlineData).length,
        2,
      );
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
