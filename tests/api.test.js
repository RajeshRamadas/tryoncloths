import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { customerPhotos } from "./helpers/customer-photos.js";
import { createApp, standardAvatar } from "../server/app.js";
import { openaiPersonalize } from "../server/openai.js";
import { geminiBodyReference } from "../server/gemini-reference.js";
import { geminiPersonalize } from "../server/gemini.js";
import { ProviderError } from "../server/provider-errors.js";

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
const defaultRequest = { consentProvider: "gemini", consentScope: "face-and-body", measurements, body: bodyPhoto };

test("the selected provider is advertised and only matching provider consent can generate", async () => {
  assert.throws(() => createApp({ provider: "unknown", apiKey: "test-only" }));
  for (const provider of ["gemini", "openai"]) {
    let calls = 0;
    await withServer({ provider, apiKey: "test-only", personalize: async () => { calls++; return face; } }, async base => {
      const health = await (await fetch(`${base}/api/health`)).json();
      assert.equal(health.provider, provider);
      if (provider === "gemini") assert.equal(health.generationRevision, "customer-first-v2");
      assert.equal(health.personalizationContract, "customer-avatar-v4");
      const valid = { consent: true, profileId: "regular", face };
      assert.equal((await post(base, { ...valid, consentProvider: provider === "gemini" ? "openai" : "gemini" })).status, 400);
      assert.equal(calls, 0);
      const response = await post(base, { ...valid, consentProvider: provider });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).provider, provider);
      assert.equal(calls, 1);
    });
  }
});

test("Gemini uses the chosen body template and both customer photos for face and whole-body complexion", async () => {
  const avatar = await standardAvatar("broad");
  let calls = 0;
  const result = await geminiPersonalize({ face: faceBytes, body: bodyBytes, avatar, profileId: "broad", measurements, apiKey: "test-only", fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent");
    assert.equal(options.headers["x-goog-api-key"], "test-only");
    const payload = JSON.parse(options.body);
    const parts = payload.contents[0].parts;
    const images = parts.filter(part => part.inlineData).map(part => part.inlineData);
    assert.equal(images.length, 3);
    assert.deepEqual(images.slice(0, 2).map(image => image.data), [faceBytes, bodyBytes].map(bytes => bytes.toString("base64")));
    assert.equal(images[2].mimeType, "image/png");
    assert.notEqual(images[2].data, avatar.toString("base64"));
    const reference = await sharp(Buffer.from(images[2].data, "base64")).metadata();
    assert.equal(reference.width / reference.height, 2 / 3);
    assert.match(parts[0].text, /Image 1 = CUSTOMER FACE/);
    assert.match(parts[0].text, /original head deliberately covered/);
    assert.match(parts[0].text, /Keep glasses if present/);
    assert.match(parts[0].text, /BOTH COMPLETE FEET AND TOES/);
    assert.match(parts[0].text, /ONE natural full-colour photograph/);
    assert.match(parts[0].text, /including the lower legs and feet/);
    assert.match(parts[0].text, /not the target complexion/);
    assert.match(parts[0].text, /selected broad STANDARD BODY TEMPLATE/);
    assert.match(parts[0].text, /CUSTOMER FACE/);
    assert.match(parts[0].text, /MATCH THE CUSTOMER.S NATURAL SKIN TONE/);
    assert.match(parts[0].text, /face, ears, neck, arms, hands, legs and feet/);
    assert.deepEqual(payload.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
    assert.equal(payload.generationConfig.imageConfig.aspectRatio, "2:3");
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: faceBytes.toString("base64") } }] } }] }));
  } });
  assert.equal(calls, 1);
  assert.match(result, /^data:image\/png;base64,/);
});

test("Gemini refuses blocked, missing or corrupt outputs without substituting a template", async () => {
  const input = { face: faceBytes, body: bodyBytes, avatar: await standardAvatar("regular"), profileId: "regular", measurements, apiKey: "test-only" };
  for (const [payload, code] of [
    [{ promptFeedback: { blockReason: "SAFETY" } }, "blocked"],
    [{ candidates: [{ content: { parts: [{ text: "no image" }] } }] }, "no_image"],
    [{ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "invalid" } }] } }] }, "invalid_image"],
  ]) await assert.rejects(geminiPersonalize({ ...input, fetchImpl: async () => new Response(JSON.stringify(payload)) }), error => error.code === code);
});

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

test("proxy-aware request limits separate clients only when one private reverse proxy is explicitly trusted", async () => {
  assert.throws(() => createApp({ trustProxy: true }));
  for (const trustProxy of [false, 1]) {
    let calls = 0;
    await withServer({ apiKey: "test-only", trustProxy, personalize: async () => { calls++; return face; } }, async base => {
      const send = client => fetch(`${base}/api/personalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: base, "X-Forwarded-For": client },
        body: JSON.stringify({ ...defaultRequest, consent: true, profileId: "regular", face }),
      });
      assert.equal((await send("192.0.2.10")).status, 200);
      assert.equal((await send("192.0.2.11")).status, trustProxy === 1 ? 200 : 429);
      assert.equal((await send("192.0.2.10")).status, 429);
      assert.equal(calls, trustProxy === 1 ? 2 : 1);
    });
  }
});

test("public browser access is explicit and keeps consent and origin validation", async () => {
  assert.throws(() => createApp({ accessMode: "protected", mobileToken: "" }));
  assert.throws(() => createApp({ accessMode: "unknown" }));
  let calls = 0;
  await withServer({ accessMode: "public", mobileToken: "obsolete-token", apiKey: "test-only", personalize: async () => { calls++; return face; } }, async base => {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).personalizationAvailable, true);
    const valid = { consent: true, profileId: "regular", face };
    assert.equal((await post(base, { ...valid, consent: false })).status, 400);
    assert.equal((await post(base, valid, "https://another-site.example")).status, 403);
    assert.equal((await post(base, valid, "https://localhost")).status, 403);
    assert.equal(calls, 0);
    assert.equal((await post(base, valid)).status, 200);
    assert.equal(calls, 1);
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
      { consentProvider: undefined },
      { consentProvider: "openai" },
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
test("provider quota errors reach the browser and logs without secrets or an automatic retry", async (t) => {
  const logs = [];
  t.mock.method(console, "error", value => logs.push(JSON.parse(value)));
  let calls = 0;
  await withServer({ apiKey: "test-secret", personalize: async () => { calls++; throw new ProviderError("quota", 429); } }, async base => {
    const response = await post(base, { consent: true, profileId: "regular", face });
    assert.equal(response.status, 502);
    const data = await response.json();
    assert.equal(data.code, "quota");
    assert.match(data.error, /separate from the app/);
    assert.doesNotMatch(JSON.stringify(data), /test-secret/);
    assert.equal(calls, 1);
    assert.deepEqual(logs, [{ event: "avatar_provider_failure", provider: "gemini", code: "quota", providerStatus: 429 }]);
  });
});

test("OpenAI responses distinguish missing, corrupt and malformed images", async () => {
  const avatar = await standardAvatar("regular");
  for (const [payload, code] of [
    [{ data: [] }, "no_image"],
    [{ data: [{ b64_json: "invalid" }] }, "invalid_image"],
    [{ data: [{ url: "https://untrusted.example/image.png" }] }, "no_image"],
  ]) {
    await assert.rejects(openaiPersonalize({ face: faceBytes, body: bodyBytes, avatar, profileId: "regular", measurements, apiKey: "test-only", fetchImpl: async () => new Response(JSON.stringify(payload)) }), error => error.code === code);
  }
  await assert.rejects(openaiPersonalize({ face: faceBytes, body: bodyBytes, avatar, profileId: "regular", measurements, apiKey: "test-only", fetchImpl: async () => new Response("not-json") }), error => error.code === "response");
});

test("OpenAI edits sends three ordered image files and requests one portrait with face and skin-tone matching", async () => {
  let calls = 0;
  const avatar = await standardAvatar("regular");
  const result = await openaiPersonalize({
    face: faceBytes, body: bodyBytes, profileId: "regular", measurements, avatar, apiKey: "test-only",
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/images/edits");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer test-only");
      assert.equal(options.headers["Content-Type"], undefined);
      assert.match(new Request(url, options).headers.get("content-type"), /^multipart\/form-data; boundary=/);
      const form = options.body;
      assert.equal(form.get("model"), "gpt-image-1.5");
      assert.equal(form.get("n"), "1");
      assert.equal(form.get("quality"), "low");
      assert.equal(form.get("size"), "1024x1536");
      assert.equal(form.get("output_format"), "png");
      assert.equal(form.get("input_fidelity"), "high");
      assert.equal(form.get("response_format"), null);
      const files = form.getAll("image[]");
      assert.equal(files.length, 3);
      assert.deepEqual(files.map(file => file.name), ["standard-body.png", "customer-face.jpg", "customer-body.jpg"]);
      assert.deepEqual(files.map(file => file.type), ["image/png", "image/jpeg", "image/jpeg"]);
      for (const [index, expected] of [avatar, faceBytes, bodyBytes].entries())
        assert.deepEqual(Buffer.from(await files[index].arrayBuffer()), expected);
      assert.match(form.get("prompt"), /MATCH THE CUSTOMER.S NATURAL SKIN TONE/);
      assert.match(form.get("prompt"), /arms, hands, legs and feet/);
      assert.match(form.get("prompt"), /selected standard body/);
      assert.match(form.get("prompt"), /175 cm and weight 72 kg/);
      return new Response(JSON.stringify({ data: [{ b64_json: faceBytes.toString("base64") }] }));
    },
  });
  assert.ok(result.startsWith("data:image/png;base64,"));
  assert.equal(calls, 1);
});

test("OpenAI configurable models omit unsupported fidelity options and failures never trigger fallback", async () => {
  const avatar = await standardAvatar("regular");
  const input = { face: faceBytes, body: bodyBytes, avatar, profileId: "regular", measurements, apiKey: "test-only" };
  for (const model of ["gpt-image-1-mini", "gpt-image-2"]) {
    let calls = 0;
    await assert.rejects(openaiPersonalize({ ...input, model, quality: "medium", fetchImpl: async (_url, options) => {
      calls++;
      assert.equal(options.body.get("input_fidelity"), null);
      assert.equal(options.body.get("quality"), "medium");
      return new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "secret" } }), { status: 429 });
    } }), error => error.code === "quota" && !error.message.includes("secret"));
    assert.equal(calls, 1);
  }
  for (const config of [{ quality: "unsupported" }, { model: "gpt-4o" }, { apiKey: "" }]) {
    await assert.rejects(openaiPersonalize({ ...input, ...config, fetchImpl: () => { throw new Error("Must not call provider"); } }), error => error.code === "configuration");
  }
});

test("every Gemini template hides identity while preserving natural body colour, texture and geometry", async () => {
  for (const id of ["slim", "regular", "athletic", "broad"]) {
    const original = await standardAvatar(id);
    const before = Buffer.from(original);
    const reference = await geminiBodyReference(original);
    assert.deepEqual(original, before, "the sample library input must remain intact");
    const { width, height } = await sharp(reference).metadata();
    assert.equal(width, 692);
    assert.equal(height, 1038);
    const { data, info } = await sharp(reference).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 3);
    let colouredPixels = 0;
    for (let i = 0; i < data.length; i += 3)
      if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 12) colouredPixels++;
    assert.ok(colouredPixels > 10000, `${id}: body reference must not be desaturated`);
    const head = await sharp(reference).extract({ left: 154 + 112, top: 48 + 12, width: 160, height: 210 }).raw().toBuffer();
    assert.ok(head.every(channel => channel === 198), `${id}: no face, hair or neck pixels may survive the mask`);
    // From below the mask to the floor: all original geometry, including toes,
    // must survive at original scale and coordinates, with natural skin colour and texture intact.
    const bodyRegion = { left: 0, top: 222, width: 384, height: 720 };
    const expected = await sharp(original).removeAlpha().extract(bodyRegion).raw().toBuffer();
    const actual = await sharp(reference).removeAlpha().extract({ ...bodyRegion, left: 154, top: 48 + 222 }).raw().toBuffer();
    assert.equal(actual.length, expected.length);
    assert.ok(actual.equals(expected), `${id}: preserve body/feet colour, texture and geometry`);
  }
  await assert.rejects(geminiBodyReference(await sharp({create:{width:400,height:900,channels:3,background:"white"}}).png().toBuffer()), /Review the identity mask/);
});
