import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createGeminiModeration,
  GEMINI_SAFETY_REVISION,
  DEFAULT_SAFETY_MODEL,
} from "../server/gemini-moderation.js";
import { loadShopperConfiguration } from "../server/shopper-config.js";
import { checkShopperConfiguration } from "../server/check-shopper.js";
import { workflowFixture, testDisclosure } from "./helpers/shopper-workflow.js";
import { safeAssessment, safetyResponse, responseForRequest } from "./helpers/gemini-safety.js";

const apiKey = "private-gemini-safety-key-123";
const image = await readFile("tests/fixtures/customers/blue-polo-face.jpg");
const input = () => ({
  images: [image, image],
  stage: "input",
  action: "avatar",
  roles: ["face", "body"],
  policy: "adult-own-photo-v1",
});
const response = (value) => new Response(JSON.stringify(value));

test("Gemini safety sends one bounded classification request with trusted roles, static instructions and metadata-stripped images", async () => {
  const photo = await sharp(image)
      .resize(1800, 1800, { fit: "inside" })
      .withMetadata({ exif: { IFD0: { Artist: "private-name" } } })
      .jpeg()
      .toBuffer(),
    calls = [];
  const adapter = createGeminiModeration({
    apiKey,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(responseForRequest(options));
    },
  });
  assert.deepEqual(await adapter.check({ ...input(), images: [photo, photo] }), {
    allowed: true,
    policy: "adult-own-photo-v1",
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, new RegExp("/" + DEFAULT_SAFETY_MODEL + ":generateContent$"));
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers["x-goog-api-key"], apiKey);
  const request = JSON.parse(calls[0].options.body);
  assert.equal(request.generationConfig.maxOutputTokens, 512);
  assert.equal(request.generationConfig.responseMimeType, "application/json");
  assert.equal(request.generationConfig.candidateCount, 1);
  assert.deepEqual(request.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.ok(!request.generationConfig.responseModalities?.includes("IMAGE"));
  assert.match(request.systemInstruction.parts[0].text, /untrusted image content/);
  assert.match(request.systemInstruction.parts[0].text, /not age or identity verification/);
  for (const part of request.contents[0].parts.filter((p) => p.inlineData)) {
    const meta = await sharp(Buffer.from(part.inlineData.data, "base64")).metadata();
    assert.equal(meta.format, "jpeg");
    assert.ok(meta.width <= 768 && meta.height <= 768);
    assert.equal(meta.exif, undefined);
  }
  assert.ok(request.safetySettings.every((s) => s.threshold === "BLOCK_LOW_AND_ABOVE"));
  assert.ok(!JSON.stringify(adapter).includes(apiKey));
  assert.ok(!JSON.stringify(await adapter.check(input())).includes("adultAppearance"));
});

test("standalone garments and one adult-looking customer are eligible; customer/output images always require a visible adult-looking face", async () => {
  const adapter = createGeminiModeration({
    apiKey,
    fetchImpl: async (url, options) => response(responseForRequest(options)),
  });
  assert.equal(
    (await adapter.check({ ...input(), action: "tryon", roles: ["avatar", "garment"] })).allowed,
    true,
  );
  assert.equal(
    (await adapter.check({ ...input(), stage: "output", roles: ["result"], images: [image] }))
      .allowed,
    true,
  );
  for (const [action, stage, roles, target] of [
    ["avatar", "input", ["face", "body"], "face"],
    ["avatar", "input", ["face", "body"], "body"],
    ["tryon", "input", ["avatar", "garment"], "avatar"],
    ["tryon", "output", ["result"], "result"],
  ]) {
    const denied = createGeminiModeration({
      apiKey,
      fetchImpl: async () =>
        response(
          safetyResponse(roles, {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    revision: GEMINI_SAFETY_REVISION,
                    assessments: roles.map((role) =>
                      role === target
                        ? {
                            ...safeAssessment(role),
                            people: 0,
                            adultAppearance: "no_person",
                            faceVisible: false,
                          }
                        : safeAssessment(role),
                    ),
                  }),
                },
              ],
            },
          }),
        ),
    });
    assert.equal(
      (await denied.check({ ...input(), action, stage, roles, images: roles.map(() => image) }))
        .allowed,
      false,
    );
  }
});

test("minor/uncertain appearance, multiple people, unsafe/sexualized content or missing faces block acceptance without retaining assessments", async () => {
  for (const change of [
    { adultAppearance: "young_or_minor" },
    { adultAppearance: "uncertain" },
    { people: 2 },
    { faceVisible: false },
    { uncertain: true },
    { sexualized: true },
    { exposedIntimateParts: true },
    { unsafeContent: true },
  ]) {
    const data = safetyResponse(["face", "body"]);
    data.candidates[0].content.parts[0].text = JSON.stringify({
      revision: GEMINI_SAFETY_REVISION,
      assessments: [{ ...safeAssessment("face"), ...change }, safeAssessment("body")],
    });
    const adapter = createGeminiModeration({ apiKey, fetchImpl: async () => response(data) });
    assert.deepEqual(await adapter.check(input()), {
      allowed: false,
      policy: "adult-own-photo-v1",
    });
  }
});

test("malformed, duplicate, reordered, missing, unknown and truncated assessments cannot be accepted", async () => {
  const make = (assessments) => JSON.stringify({ revision: GEMINI_SAFETY_REVISION, assessments });
  const values = [
    "{}",
    "not JSON",
    "```json\n{}\n```",
    make([safeAssessment("face")]),
    make([safeAssessment("body"), safeAssessment("face")]),
    make([safeAssessment("face"), { ...safeAssessment("body"), unknown: true }]),
    make([{ ...safeAssessment("face"), uncertain: "false" }, safeAssessment("body")]),
    make([safeAssessment("face"), safeAssessment("body")]).replace(
      '"people":1',
      '"people":1,"people":1',
    ),
  ];
  for (const value of values) {
    const data = safetyResponse(["face", "body"]);
    data.candidates[0].content.parts[0].text = value;
    await assert.rejects(
      createGeminiModeration({ apiKey, fetchImpl: async () => response(data) }).check(input()),
      /unavailable/,
    );
  }
  for (const finishReason of ["MAX_TOKENS", "OTHER", "STOP_UNKNOWN"])
    await assert.rejects(
      createGeminiModeration({
        apiKey,
        fetchImpl: async () => response(safetyResponse(["face", "body"], { finishReason })),
      }).check(input()),
      /unavailable/,
    );
});

test("provider safety blocks and non-negligible safety ratings never become accepted previews", async () => {
  for (const data of [
    { promptFeedback: { blockReason: "SAFETY" } },
    safetyResponse(["face", "body"], { finishReason: "SAFETY" }),
    safetyResponse(["face", "body"], { safetyRatings: [{ probability: "LOW" }] }),
    safetyResponse(["face", "body"], {
      safetyRatings: [{ probability: "NEGLIGIBLE", blocked: true }],
    }),
  ])
    assert.equal(
      (
        await createGeminiModeration({ apiKey, fetchImpl: async () => response(data) }).check(
          input(),
        )
      ).allowed,
      false,
    );
});

test("bad role/purpose/image inputs and unsafe model configuration fail before any provider request", async () => {
  let calls = 0;
  const adapter = createGeminiModeration({
    apiKey,
    fetchImpl: async () => {
      calls++;
      return response(safetyResponse(["face", "body"]));
    },
  });
  for (const change of [
    { roles: ["garment", "body"] },
    { policy: "other" },
    { action: "other" },
    { stage: "other" },
    { images: [] },
    { images: [Buffer.from("<svg/>"), image] },
    { images: [Buffer.alloc(10 * 1024 * 1024 + 1), image] },
  ])
    await assert.rejects(adapter.check({ ...input(), ...change }));
  assert.equal(calls, 0);
  for (const model of ["https://evil.test/model", "gemini-2.5-flash-image", "gemini-embedding-001"])
    assert.throws(() => createGeminiModeration({ apiKey, model }));
  assert.throws(() => createGeminiModeration({ apiKey: "" }));
});

test("transport errors, quotas and oversized/unreadable responses are sanitized and never retried", async () => {
  for (const reply of [
    () => {
      throw new Error(apiKey);
    },
    () => new Response(apiKey, { status: 429 }),
    () => new Response("x".repeat(65537)),
    () => new Response("{}", { headers: { "content-length": "70000" } }),
    () => new Response("not-json"),
  ]) {
    let calls = 0;
    const adapter = createGeminiModeration({
      apiKey,
      fetchImpl: async () => {
        calls++;
        return reply();
      },
    });
    await assert.rejects(
      adapter.check(input()),
      (error) =>
        error.message === "Shopper image safety review is unavailable." &&
        !error.message.includes(apiKey),
    );
    assert.equal(calls, 1);
  }
});

test("cancellation reaches the safety transport and model changes invalidate the service identifier without encoding the key", async () => {
  let started;
  const ready = new Promise((resolve) => {
      started = resolve;
    }),
    controller = new AbortController();
  const adapter = createGeminiModeration({
    apiKey,
    fetchImpl: async (url, { signal }) => {
      started();
      return new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    },
  });
  const pending = adapter.check({ ...input(), signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(pending);
  assert.equal(adapter.id, createGeminiModeration({ apiKey: "rotated-key" }).id);
  assert.notEqual(adapter.id, createGeminiModeration({ apiKey, model: "gemini-2.5-flash" }).id);
  assert.match(adapter.id, /^gemini-safety-[a-f0-9]{16}$/);
});

test("failed provider responses are cancelled without buffering their private error bodies", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("private error body"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const adapter = createGeminiModeration({
    apiKey,
    fetchImpl: async () => new Response(body, { status: 500 }),
  });
  await assert.rejects(adapter.check(input()), /unavailable/);
  assert.equal(cancelled, true);
});

test("startup selection uses Gemini only when explicitly requested, permits a separate key and rejects conflicting/invalid safety configuration", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forme-gemini-safety-"));
  try {
    const module = path.join(directory, "services.mjs");
    await writeFile(
      module,
      `export default {disclosure:${JSON.stringify(testDisclosure)},moderation:null};`,
    );
    const env = { TRYON_SHOPPER_CONFIG_MODULE: module, TRYON_GEMINI_API_KEY: apiKey };
    assert.equal((await loadShopperConfiguration({ env })).shopperSessionOptions.moderation, null);
    const config = await loadShopperConfiguration({
      env: { ...env, TRYON_SHOPPER_MODERATION: "gemini" },
    });
    assert.equal(config.source.status, "loaded");
    assert.equal(config.shopperSessionOptions.moderation.provider, "gemini");
    assert.ok(!JSON.stringify(config).includes(apiKey));
    assert.equal(
      (
        await loadShopperConfiguration({
          env: { TRYON_SHOPPER_MODERATION: "gemini", TRYON_SHOPPER_MODERATION_API_KEY: apiKey },
        })
      ).shopperSessionOptions.moderation.provider,
      "gemini",
    );
    for (const change of [
      { TRYON_SHOPPER_MODERATION: "other" },
      { TRYON_SHOPPER_MODERATION_MODEL: "gemini-image" },
      { TRYON_GEMINI_API_KEY: "" },
    ])
      assert.equal(
        (
          await loadShopperConfiguration({
            env: { ...env, TRYON_SHOPPER_MODERATION: "gemini", ...change },
          })
        ).source.code,
        "moderation_invalid",
      );
    const custom = path.join(directory, "custom.mjs");
    await writeFile(custom, "export default {moderation:{id:'custom',check(){}}};");
    assert.equal(
      (
        await loadShopperConfiguration({
          env: { ...env, TRYON_SHOPPER_CONFIG_MODULE: custom, TRYON_SHOPPER_MODERATION: "gemini" },
        })
      ).source.code,
      "moderation_invalid",
    );
    const preflight = await checkShopperConfiguration({
      env: { ...env, TRYON_SHOPPER_MODERATION: "gemini" },
    });
    assert.equal(preflight.safety.model, DEFAULT_SAFETY_MODEL);
    assert.equal(preflight.liveVerified, false);
    assert.ok(!JSON.stringify(preflight).includes(apiKey));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("guarded avatar/try-on calls send server-controlled image roles and bound input/output review calls while reusing the approved avatar", async () => {
  const calls = [],
    adapter = createGeminiModeration({
      apiKey,
      fetchImpl: async (url, options) => {
        calls.push(JSON.parse(options.body));
        return response(responseForRequest(options));
      },
    }),
    f = await workflowFixture({ sessionOptions: { moderation: adapter } });
  try {
    const browser = await f.open(),
      result = await f.request("avatar", {
        ...browser,
        method: "POST",
        headers: await f.authorize(browser),
        body: f.avatarBody(),
      });
    assert.equal(result.status, 200);
    const avatar = await result.json();
    assert.equal(calls.length, 2);
    assert.equal(
      (
        await f.request("avatar/approve", {
          ...browser,
          method: "POST",
          body: { approval: avatar.approval, approved: true },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request("tryon", {
          ...browser,
          method: "POST",
          headers: await f.authorize(browser, "tryon"),
          body: { requestId: randomUUID(), avatar: avatar.image },
        })
      ).status,
      200,
    );
    assert.equal(calls.length, 4);
    assert.equal(f.calls.avatar.length, 1);
    assert.equal(f.calls.tryon.length, 1);
    assert.equal(f.store.shoppers.view(f.a).store.moderation, 4);
    assert.equal(f.store.billing.balance(f.a.org), 998);
    assert.deepEqual(
      calls[2].contents[0].parts
        .filter((p) => p.text)
        .map((p) => p.text.split("trusted role: ")[1]),
      ["avatar", "garment"],
    );
    assert.ok(
      !JSON.stringify(f.state.db.prepare("SELECT * FROM shopper_state").all()).includes(
        "adultAppearance",
      ),
    );
  } finally {
    await f.close();
  }
});

test("input rejection makes no image call; output rejection refunds the hold while preserving the dispatched attempt", async () => {
  for (const rejectedStage of ["input", "output"]) {
    let calls = 0;
    const adapter = createGeminiModeration({
        apiKey,
        fetchImpl: async (url, options) => {
          calls++;
          const data = responseForRequest(options);
          if (calls === (rejectedStage === "input" ? 1 : 2)) {
            const content = JSON.parse(data.candidates[0].content.parts[0].text);
            content.assessments[0].uncertain = true;
            data.candidates[0].content.parts[0].text = JSON.stringify(content);
          }
          return response(data);
        },
      }),
      f = await workflowFixture({ sessionOptions: { moderation: adapter } });
    try {
      const browser = await f.open(),
        result = await f.request("avatar", {
          ...browser,
          method: "POST",
          headers: await f.authorize(browser),
          body: f.avatarBody(),
        });
      assert.equal(result.status, 422);
      assert.ok(!(await result.text()).includes("data:image"));
      assert.equal(f.calls.avatar.length, rejectedStage === "input" ? 0 : 1);
      assert.equal(f.store.billing.balance(f.a.org), 1000);
      assert.equal(f.store.shoppers.view(f.a).store.dispatched, rejectedStage === "input" ? 0 : 1);
      assert.equal(f.store.db.prepare("SELECT count(*) n FROM avatars").get().n, 0);
    } finally {
      await f.close();
    }
  }
});

test("a moderation model change invalidates earlier consent/proof before photos are parsed or any paid request is sent", async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
      calls++;
      return response(responseForRequest(options));
    },
    f = await workflowFixture({
      sessionOptions: { moderation: createGeminiModeration({ apiKey, fetchImpl }) },
    });
  try {
    const browser = await f.open(),
      headers = await f.authorize(browser);
    f.sessions.moderation = createGeminiModeration({
      apiKey,
      model: "gemini-2.5-flash",
      fetchImpl,
    });
    const rejected = await f.request("avatar", {
      ...browser,
      method: "POST",
      headers,
      body: f.avatarBody(),
    });
    assert.equal(rejected.status, 403);
    assert.equal(calls, 0);
    assert.equal(f.calls.avatar.length, 0);
  } finally {
    await f.close();
  }
});

test("ending during output safety review aborts its transport, discards the result and refunds the image hold exactly once", async () => {
  let started, safetySignal;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const moderation = createGeminiModeration({
      apiKey,
      fetchImpl: async (url, options) => {
        const data = responseForRequest(options),
          role = JSON.parse(data.candidates[0].content.parts[0].text).assessments[0].role;
        if (role === "result") {
          safetySignal = options.signal;
          started();
          return new Promise((resolve, reject) =>
            options.signal.addEventListener("abort", () => reject(options.signal.reason), {
              once: true,
            }),
          );
        }
        return response(data);
      },
    }),
    f = await workflowFixture({ sessionOptions: { moderation } });
  try {
    const browser = await f.open(),
      pending = f.request("avatar", {
        ...browser,
        method: "POST",
        headers: await f.authorize(browser),
        body: f.avatarBody(),
      });
    await ready;
    assert.equal((await f.request("session", { ...browser, method: "DELETE" })).status, 204);
    const result = await pending;
    assert.equal(result.status, 410);
    assert.ok(!(await result.text()).includes("data:image"));
    assert.equal(safetySignal.aborted, true);
    assert.equal(f.store.billing.balance(f.a.org), 1000);
    assert.equal(f.store.shoppers.view(f.a).store.dispatched, 1);
    assert.equal(f.store.shoppers.view(f.a).store.moderation, 2);
  } finally {
    await f.close();
  }
});
