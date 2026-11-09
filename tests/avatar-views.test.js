import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import {
  generatePortrait,
  createPortraitGenerator,
  portraitPrompt,
  requirePortraitFraming,
  PORTRAIT_WIDTH,
  PORTRAIT_HEIGHT,
} from "../server/avatar-views.js";
import { ProviderError, providerErrorDetails } from "../server/provider-errors.js";
import { withFaceApi, detectFaces } from "../server/face-check.js";
import { standardAvatar } from "../server/app.js";

const face = await readFile(new URL("fixtures/customers/red-plaid-face.jpg", import.meta.url));
const avatar = await standardAvatar("regular");
const blank = await sharp({
  create: { width: 1152, height: 1536, channels: 3, background: "#d9d7d3" },
})
  .png()
  .toBuffer();
const box = (ratio) => [{ box: { x: 300, y: 160, width: 450, height: 1536 * ratio } }];
const ok = () =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              { text: "One portrait" },
              { inlineData: { mimeType: "image/png", data: blank.toString("base64") } },
            ],
          },
        },
      ],
    }),
  );
const code = (expected) => (error) => error instanceof ProviderError && error.code === expected;
const stub = (overrides) =>
  createPortraitGenerator({
    faceCheck: async () => {},
    detect: async () => box(0.45),
    identityCheck: async () => 0.1,
    ...overrides,
  });
const input = { facePhoto: face, avatar, apiKey: "test-key-only" };

test("portrait request sends customer JPEG before approved avatar PNG with one candidate, 3:4 aspect and optional agreed hair change", async () => {
  for (const hairBehindEars of [false, true]) {
    let calls = 0,
      identity = 0;
    const refs = [];
    const generate = stub({
      faceCheck: async (bytes) => {
        refs.push(bytes);
        assert.equal((await sharp(bytes).metadata()).format, "jpeg");
      },
      identityCheck: async (reference, candidate) => {
        identity++;
        refs.push(reference);
        assert.equal((await sharp(reference).metadata()).format, "png");
        assert.equal((await sharp(candidate).metadata()).width, 1152);
        return 0.12;
      },
    });
    const originalFace = Buffer.from(face),
      originalAvatar = Buffer.from(avatar);
    const result = await generate({
      ...input,
      hairBehindEars,
      fetchImpl: async (url, options) => {
        calls++;
        assert.equal(
          url,
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
        );
        assert.equal(options.method, "POST");
        assert.equal(options.headers["x-goog-api-key"], "test-key-only");
        assert.ok(options.signal instanceof AbortSignal);
        const request = JSON.parse(options.body),
          parts = request.contents[0].parts,
          images = parts.filter((p) => p.inlineData).map((p) => p.inlineData);
        assert.equal(request.contents.length, 1);
        assert.deepEqual(
          images.map((p) => p.mimeType),
          ["image/jpeg", "image/png"],
        );
        const a = await sharp(Buffer.from(images[0].data, "base64")).metadata(),
          b = await sharp(Buffer.from(images[1].data, "base64")).metadata();
        assert.equal(a.width, 220);
        assert.equal(b.height, 942);
        assert.notEqual(images[0].data, images[1].data);
        assert.deepEqual(request.generationConfig, {
          candidateCount: 1,
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: "3:4" },
        });
        const prompt = parts[0].text;
        assert.match(prompt, /identity reference/);
        assert.match(prompt, /skin tone/);
        assert.match(prompt, /glasses/);
        assert.match(prompt, /collarbones/);
        assert.match(prompt, /top colour/);
        assert.match(prompt, /Do not add jewellery/);
        assert.equal(/hair behind/i.test(prompt), hairBehindEars);
        assert.doesNotMatch(options.body, /descriptor|face-for-portrait|secret-instruction/);
        return ok();
      },
    });
    assert.match(result, /^data:image\/png;base64,/);
    const meta = await sharp(Buffer.from(result.split(",")[1], "base64")).metadata();
    assert.equal(meta.width, 1152);
    assert.equal(meta.height, 1536);
    assert.equal(calls, 1);
    assert.equal(identity, 1);
    for (const bytes of refs) assert.ok(bytes.every((n) => n === 0));
    assert.deepEqual(face, originalFace);
    assert.deepEqual(avatar, originalAvatar);
  }
  assert.throws(() => portraitPrompt({ hairBehindEars: "true" }), code("portrait_input"));
});

test("portrait framing requires one complete face at inclusive 35–55 percent height", async () => {
  for (const ratio of [0.35, 0.45, 0.55])
    await requirePortraitFraming(blank, { detect: async () => box(ratio) });
  for (const faces of [[], [...box(0.45), ...box(0.45)]])
    await assert.rejects(
      requirePortraitFraming(blank, { detect: async () => faces }),
      code("missing_face"),
    );
  for (const faces of [
    box(0.349),
    box(0.551),
    [{ box: { x: -1, y: 150, width: 400, height: 700 } }],
    [{ box: { x: 1000, y: 150, width: 400, height: 700 } }],
    [{ box: { x: 300, y: 1000, width: 400, height: 700 } }],
  ])
    await assert.rejects(
      requirePortraitFraming(blank, { detect: async () => faces }),
      code("framing_changed"),
    );
  for (const faces of [null, [{}], [{ box: { x: 0, y: 0, width: NaN, height: 700 } }]])
    await assert.rejects(
      requirePortraitFraming(blank, { detect: async () => faces }),
      code("face_check"),
    );
  await assert.rejects(
    requirePortraitFraming(await sharp(blank).resize(576, 768).png().toBuffer(), {
      detect: async () => box(0.45),
    }),
    code("framing_changed"),
  );
  await assert.rejects(requirePortraitFraming(Buffer.from("invalid")), code("invalid_image"));
});

test("invalid configuration, unsupported images and invalid hair consent fail before any paid request", async () => {
  let calls = 0;
  const generate = stub(),
    base = {
      ...input,
      fetchImpl: async () => {
        calls++;
        return ok();
      },
    };
  for (const apiKey of ["", null, {}, " "])
    await assert.rejects(generate({ ...base, apiKey }), code("configuration"));
  for (const model of ["../secret", "gemini?key=x", "", null, Array(2)])
    await assert.rejects(generate({ ...base, model }), code("configuration"));
  for (const facePhoto of [
    undefined,
    "data:image/jpeg;base64,x",
    Buffer.from("bad"),
    await sharp({ create: { width: 100, height: 100, channels: 3, background: "white" } })
      .png()
      .toBuffer(),
  ])
    await assert.rejects(generate({ ...base, facePhoto }), code("face_input"));
  for (const invalidAvatar of [
    undefined,
    await sharp(avatar).jpeg().toBuffer(),
    await sharp(blank).resize(500, 500).png().toBuffer(),
  ])
    await assert.rejects(generate({ ...base, avatar: invalidAvatar }), code("portrait_input"));
  await assert.rejects(generate({ ...base, hairBehindEars: 1 }), code("portrait_input"));
  assert.equal(calls, 0);
  const rejected = stub({
    faceCheck: async () => {
      throw new ProviderError("face_input");
    },
  });
  await assert.rejects(rejected(base), code("face_input"));
  assert.equal(calls, 0);
});

test("faceless, wrongly framed and different-person responses are rejected after exactly one request", async () => {
  for (const [expected, overrides] of [
    ["missing_face", { detect: async () => [] }],
    ["missing_face", { detect: async () => [...box(0.45), ...box(0.45)] }],
    ["framing_changed", { detect: async () => box(0.2) }],
    [
      "identity_mismatch",
      {
        identityCheck: async () => {
          throw new ProviderError("identity_mismatch");
        },
      },
    ],
  ]) {
    let calls = 0;
    await assert.rejects(
      stub(overrides)({
        ...input,
        fetchImpl: async () => {
          calls++;
          return ok();
        },
      }),
      code(expected),
    );
    assert.equal(calls, 1);
  }
  for (const stage of ["faceCheck", "detect", "identityCheck"]) {
    let calls = 0;
    await assert.rejects(
      stub({
        [stage]: async () => {
          throw new Error("PRIVATE PHOTO AND MODEL DETAILS");
        },
      })({
        ...input,
        fetchImpl: async () => {
          calls++;
          return ok();
        },
      }),
      (error) => {
        assert.equal(error.code, "face_check");
        assert.doesNotMatch(error.message, /PRIVATE PHOTO|MODEL DETAILS/);
        return true;
      },
    );
    assert.equal(calls, stage === "faceCheck" ? 0 : 1);
  }
});

test("Gemini errors and malformed outputs are sanitized without fallback or retry", async () => {
  const cases = [
    [
      "quota",
      () => new Response(JSON.stringify({ error: { message: "PRIVATE KEY" } }), { status: 429 }),
    ],
    ["credentials", () => new Response("{}", { status: 401 })],
    [
      "timeout",
      () => {
        throw Object.assign(new Error("PRIVATE KEY"), { name: "TimeoutError" });
      },
    ],
    ["response", () => new Response("not json")],
    [
      "blocked",
      () => new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY PRIVATE" } })),
    ],
    [
      "blocked",
      () => new Response(JSON.stringify({ candidates: [{ finishReason: "IMAGE_SAFETY" }] })),
    ],
    [
      "no_image",
      () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "PRIVATE provider text" }] } }],
          }),
        ),
    ],
    [
      "response",
      () => new Response(JSON.stringify({ candidates: [{ content: { parts: "bad shape" } }] })),
    ],
    ...[
      ["image/svg+xml", Buffer.from("<svg/>").toString("base64")],
      ["image/png", "not base64!"],
      ["image/png", 123],
      ["image/png", "YQ=="],
      ["image/jpeg", blank.toString("base64")],
    ].map(([mimeType, data]) => [
      "invalid_image",
      () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }],
          }),
        ),
    ]),
  ];
  for (const [expected, reply] of cases) {
    let calls = 0;
    await assert.rejects(
      stub()({
        ...input,
        fetchImpl: async () => {
          calls++;
          return reply();
        },
      }),
      (error) => {
        assert.equal(error.code, expected);
        const details = providerErrorDetails(error, "gemini");
        assert.doesNotMatch(JSON.stringify(details), /PRIVATE|test-key-only|descriptor/);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test("normalization uses a 1152×1536 top-aligned cover crop, preserves source order and strips alpha", async () => {
  const landscape = await sharp({
    create: { width: 1600, height: 1600, channels: 4, background: "#fe0000" },
  })
    .composite([
      {
        input: { create: { width: 1600, height: 200, channels: 4, background: "#00ff00" } },
        top: 1400,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
  let checked = false;
  const generate = stub({
    detect: async (png) => {
      const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.channels, 3);
      const last = (info.width * info.height - 1) * 3;
      assert.ok(
        data[last] < 10 && data[last + 1] > 240,
        "the bottom colour survives the top-aligned horizontal crop",
      );
      checked = true;
      return box(0.45);
    },
  });
  await generate({
    ...input,
    facePhoto: await sharp(face).webp().toBuffer(),
    fetchImpl: async (_url, options) => {
      const images = JSON.parse(options.body).contents[0].parts.filter((p) => p.inlineData);
      assert.equal(images[0].inlineData.mimeType, "image/jpeg");
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { mimeType: "image/png", data: landscape.toString("base64") } },
                ],
              },
            },
          ],
        }),
      );
    },
  });
  assert.equal(checked, true);
  // A taller source verifies that cropping keeps the top rather than centring.
  const tall = await sharp({
    create: { width: 1152, height: 1800, channels: 3, background: "#fe0000" },
  })
    .composite([
      {
        input: { create: { width: 1152, height: 150, channels: 3, background: "#00ff00" } },
        left: 0,
        top: 1650,
      },
    ])
    .png()
    .toBuffer();
  await stub({
    detect: async (png) => {
      const bytes = await sharp(png).raw().toBuffer();
      assert.ok(bytes[bytes.length - 3] > 240 && bytes[bytes.length - 2] < 10);
      return box(0.45);
    },
  })({
    ...input,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: "image/png", data: tall.toString("base64") } }],
              },
            },
          ],
        }),
      ),
  });
});

test("cancellation before the request and during checks never returns an image or retries", async () => {
  for (const stage of ["before", "input", "request", "framing", "identity"]) {
    const controller = new AbortController();
    let calls = 0,
      identity = 0;
    if (stage === "before") controller.abort();
    const generate = stub({
      faceCheck: async () => {
        if (stage === "input") controller.abort();
      },
      detect: async () => {
        if (stage === "framing") controller.abort();
        return box(0.45);
      },
      identityCheck: async () => {
        identity++;
        if (stage === "identity") controller.abort();
      },
    });
    await assert.rejects(
      generate({
        ...input,
        signal: controller.signal,
        fetchImpl: async (_url, options) => {
          calls++;
          if (stage === "request") {
            controller.abort();
            assert.equal(options.signal.aborted, true);
          }
          return ok();
        },
      }),
      code("timeout"),
    );
    assert.equal(calls, ["before", "input"].includes(stage) ? 0 : 1);
    assert.equal(identity, stage === "identity" ? 1 : 0);
  }
});

test("real local portrait checks accept an independent synthetic face, reject a face swap, and recover from detector errors", async () => {
  const jpeg = await sharp(face).rotate().jpeg({ quality: 90 }).toBuffer(),
    reference = await sharp(jpeg).png().toBuffer();
  const [found] = await detectFaces(reference);
  assert.ok(found);
  const scale = (1536 * 0.45) / found.box.height,
    w = Math.round(160 * scale),
    h = Math.round(210 * scale);
  const portrait = await sharp({
    create: { width: 1152, height: 1536, channels: 3, background: "#d9d7d3" },
  })
    .composite([
      {
        input: await sharp(reference)
          .extract({ left: 20, top: 0, width: 160, height: 210 })
          .resize(w, h)
          .png()
          .toBuffer(),
        left: Math.round((1152 - w) / 2),
        top: 80,
      },
    ])
    .png()
    .toBuffer();
  let calls = 0;
  const respond = async () => {
    calls++;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: "image/png", data: portrait.toString("base64") } }],
            },
          },
        ],
      }),
    );
  };
  const result = await generatePortrait({ ...input, fetchImpl: respond });
  assert.match(result, /^data:image\/png;base64,/);
  assert.equal(calls, 1);
  const different = await readFile(
    new URL("fixtures/customers/blue-polo-face.jpg", import.meta.url),
  );
  await assert.rejects(
    generatePortrait({ ...input, facePhoto: different, fetchImpl: respond }),
    code("identity_mismatch"),
  );
  assert.equal(calls, 2);
  await assert.rejects(
    generatePortrait({
      ...input,
      facePhoto: await sharp(blank).jpeg().toBuffer(),
      fetchImpl: respond,
    }),
    code("face_input"),
  );
  assert.equal(calls, 2);
  const api = await withFaceApi((api) => api),
    original = api.nets.tinyFaceDetector.locateFaces;
  try {
    api.nets.tinyFaceDetector.locateFaces = async () => {
      throw new Error("PRIVATE DETECTOR FAILURE");
    };
    await assert.rejects(requirePortraitFraming(portrait), code("face_check"));
  } finally {
    api.nets.tinyFaceDetector.locateFaces = original;
  }
  await requirePortraitFraming(portrait);
});

test("portrait helper adds no storage, logging, HTTP routes or production generation wiring", async () => {
  const source = await readFile(new URL("../server/avatar-views.js", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /console\s*\.|\b(?:writeFile|appendFile|createWriteStream)\s*\(|\bdb\s*\.|\.(?:json|send|write)\s*\(/,
  );
  for (const name of ["app.js", "accounts.js", "garment-routes.js"])
    assert.doesNotMatch(
      await readFile(new URL("../server/" + name, import.meta.url), "utf8"),
      /from\s+['"].*avatar-views/,
    );
});
