import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  workflowFixture,
  testDisclosure,
  testVerificationClient,
} from "./helpers/shopper-workflow.js";
import { publicStudio } from "./helpers/shopify-shopper.js";
import { request as httpRequest } from "node:http";

const fixture = (run) => async () => {
  const f = await workflowFixture({ secondProduct: true });
  try {
    await run(f);
  } finally {
    await f.close();
  }
};
const generateAvatar = async (f, browser) => {
  const headers = await f.authorize(browser);
  const response = await f.request("avatar", {
    ...browser,
    method: "POST",
    headers,
    body: f.avatarBody(),
  });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return response.json();
};
const approve = async (f, browser, avatar) =>
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

test(
  "workflow launch exposes only public reviewed configuration and keeps safety, disclosure and image configuration fail-closed",
  fixture(async (f) => {
    const browser = await f.open();
    assert.equal(browser.data.shopperGenerationAvailable, true);
    assert.equal(browser.data.stage, "hosted-workflow");
    assert.equal(browser.data.workflow.providerLabel, "Google Gemini");
    assert.equal(browser.data.workflow.profiles.length, 4);
    assert.equal(browser.data.workflow.skinTones.length, 6);
    assert.ok(!JSON.stringify(browser.data).includes("test-key-only"));
    assert.equal(f.service.summary(f.a).shopperGenerationAvailable, true);
    const { workflow } = f;
    for (const changed of [
      { enabled: false },
      { apiKey: "" },
      { disclosure: { ...testDisclosure, revision: "different" } },
      { disclosure: { ...testDisclosure, privacyUrl: "http://localhost/privacy" } },
      { verificationClient: { ...testVerificationClient, id: "different" } },
      {
        verificationClient: {
          ...testVerificationClient,
          scriptOrigins: ["https://public.example.test; unsafe-inline"],
        },
      },
    ]) {
      const original = Object.fromEntries(Object.keys(changed).map((key) => [key, workflow[key]]));
      Object.assign(workflow, changed);
      assert.equal(
        (await (await f.request("session", browser)).json()).shopperGenerationAvailable,
        false,
      );
      const denied = await fetch(f.base + "/shopper-api/avatar", {
        method: "POST",
        headers: {
          Origin: publicStudio,
          Cookie: browser.cookie,
          "X-Shopper-CSRF": browser.csrf,
          "Content-Type": "application/json",
        },
        body: '{"private-photo-data":',
      });
      assert.equal(denied.status, 503);
      assert.ok(!(await denied.text()).includes("private-photo-data"));
      Object.assign(workflow, original);
    }
    f.sessions.moderation = null;
    assert.equal((await f.request("verification.js", browser)).status, 503);
    assert.equal(f.calls.avatar.length, 0);
  }),
);

test(
  "generation authenticates and verifies before parsing photos; parser errors and arbitrary client fields cannot reach the adapter",
  fixture(async (f) => {
    const browser = await f.open();
    for (const headers of [
      { Cookie: "forme_session=" + f.staffToken },
      { Cookie: browser.cookie, "X-Shopper-CSRF": "wrong" },
      { Cookie: browser.cookie, "X-Shopper-CSRF": browser.csrf },
    ]) {
      const response = await fetch(f.base + "/shopper-api/avatar", {
        method: "POST",
        headers: { Origin: publicStudio, "Content-Type": "application/json", ...headers },
        body: '{"sensitive-photo":',
      });
      assert.ok([401, 403].includes(response.status));
      assert.ok(!(await response.text()).includes("sensitive-photo"));
    }
    const headers = await f.authorize(browser);
    assert.equal(
      (
        await f.request("avatar", {
          ...browser,
          method: "POST",
          headers,
          body: { ...f.avatarBody(), storeId: f.b.id },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request("avatar", {
          ...browser,
          method: "POST",
          headers,
          body: {
            ...f.avatarBody(),
            measurements: { heightCm: 175, weightKg: 72, prompt: "change face" },
          },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request("avatar", {
          ...browser,
          method: "POST",
          headers,
          body: { ...f.avatarBody(), profileId: "f-regular" },
        })
      ).status,
      400,
    );
    const invalid = await fetch(f.base + "/shopper-api/avatar", {
      method: "POST",
      headers: {
        Origin: publicStudio,
        Cookie: browser.cookie,
        "X-Shopper-CSRF": browser.csrf,
        "Content-Type": "application/json",
        ...headers,
      },
      body: '{"sensitive-photo":',
    });
    assert.equal(invalid.status, 400);
    assert.ok(!(await invalid.text()).includes("sensitive-photo"));
    assert.equal(f.calls.avatar.length, 0);
  }),
);

test(
  "HTTP avatar review and same-store product try-ons use immutable adapters, exact approved bytes and no durable shopper image records",
  fixture(async (f) => {
    const browser = await f.open(),
      avatar = await generateAvatar(f, browser);
    assert.ok(avatar.needsReview);
    assert.ok(avatar.approval);
    assert.equal(f.calls.avatar.length, 1);
    assert.equal(f.calls.avatar[0].profileId, "regular");
    assert.equal(f.calls.avatar[0].templateTone, "tan");
    assert.deepEqual(f.calls.avatar[0].measurements, { heightCm: 175, weightKg: 72 });
    assert.ok(Buffer.isBuffer(f.calls.avatar[0].avatar));
    assert.equal(
      (
        await f.request("consent", {
          ...browser,
          method: "POST",
          body: {
            action: "tryon",
            provider: "gemini",
            revision: testDisclosure.revision,
            adult: true,
            ownPhotos: true,
            accepted: true,
          },
        })
      ).status,
      409,
    );
    await approve(f, browser, avatar);
    const products = (await (await f.request("products", browser)).json()).products;
    assert.equal(products.length, 2);
    assert.ok(!JSON.stringify(products).includes(f.item.id));
    assert.ok(!JSON.stringify(products).includes(f.a.id));
    let headers = await f.authorize(browser, "tryon");
    const first = await f.request("tryon", {
      ...browser,
      method: "POST",
      headers,
      body: { requestId: randomUUID(), avatar: avatar.image },
    });
    assert.equal(first.status, 200);
    assert.equal(f.calls.tryon[0].title, "Blue shirt");
    assert.equal(f.calls.tryon[0].garmentType, "shirt");
    assert.equal(f.calls.avatar.length, 1);
    headers = await f.authorize(browser, "tryon");
    const other = products.find((p) => !p.selected);
    assert.equal(
      (
        await f.request("product", {
          ...browser,
          method: "POST",
          body: { selection: other.selection },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request("tryon", {
          ...browser,
          method: "POST",
          headers,
          body: { requestId: randomUUID(), avatar: avatar.image },
        })
      ).status,
      403,
      "changing products invalidates earlier consent/proof",
    );
    headers = await f.authorize(browser, "tryon");
    assert.equal(
      (
        await f.request("tryon", {
          ...browser,
          method: "POST",
          headers,
          body: { requestId: randomUUID(), avatar: avatar.image },
        })
      ).status,
      200,
    );
    assert.equal(f.calls.tryon[1].title, "White T-shirt");
    assert.equal(f.calls.avatar.length, 1);
    assert.equal(f.store.billing.balance(f.a.org), 997);
    assert.equal(f.store.shoppers.view(f.a).store.dispatched, 3);
    assert.equal(f.store.db.prepare("SELECT count(*) n FROM avatars").get().n, 0);
    assert.equal(f.store.db.prepare("SELECT count(*) n FROM looks").get().n, 0);
    assert.equal(f.store.db.prepare("SELECT count(*) n FROM customers").get().n, 0);
    const transient = JSON.stringify(f.state.db.prepare("SELECT * FROM shopper_state").all());
    assert.ok(!transient.includes("data:image"));
    assert.ok(!transient.includes("heightCm"));
    assert.ok(!transient.includes("weightKg"));
  }),
);

test(
  "product capabilities cannot cross sessions, stores or changed catalogue revisions and arbitrary images/prompts are rejected",
  fixture(async (f) => {
    const browser = await f.open(),
      other = await f.open(),
      products = (await (await f.request("products", browser)).json()).products;
    assert.equal(
      (
        await f.request("product", {
          ...other,
          method: "POST",
          body: { selection: products[1].selection },
        })
      ).status,
      403,
    );
    for (const body of [
      { selection: f.item.id },
      { selection: products[1].selection, storeId: f.b.id },
      { url: "https://example.test/item" },
    ])
      assert.ok(
        [400, 403].includes(
          (await f.request("product", { ...browser, method: "POST", body })).status,
        ),
      );
    const avatar = await generateAvatar(f, browser);
    await approve(f, browser, avatar);
    const headers = await f.authorize(browser, "tryon");
    assert.equal(
      (
        await f.request("tryon", {
          ...browser,
          method: "POST",
          headers,
          body: { requestId: randomUUID(), avatar: avatar.image, garment: avatar.image },
        })
      ).status,
      400,
    );
    f.store.db.prepare("UPDATE garments SET name=? WHERE id=?").run("Changed shirt", f.item.id);
    assert.equal((await f.request("products", browser)).status, 410);
    assert.equal(f.calls.tryon.length, 0);
  }),
);

test(
  "provider quota and timeouts are explicit, refund holds and preserve dispatched attempts; request replay never retries",
  fixture(async (f) => {
    const browser = await f.open();
    let last;
    for (const [mode, status] of [
      ["quota", 429],
      ["timeout", 504],
      ["unknown", 502],
    ]) {
      f.setGenerationMode(mode);
      const headers = await f.authorize(browser),
        body = f.avatarBody();
      const response = await f.request("avatar", { ...browser, method: "POST", headers, body });
      assert.equal(response.status, status);
      const error = await response.json();
      assert.match(error.error, /No automatic retry|no automatic retry/);
      assert.ok(!JSON.stringify(error).includes("private-provider"));
      assert.equal(f.store.billing.balance(f.a.org), 1000);
      assert.equal(f.store.shoppers.view(f.a).store.held, 0);
      last = { headers, body };
    }
    const repeated = await f.request("avatar", { ...browser, method: "POST", ...last });
    assert.equal(repeated.status, 403);
    assert.equal(f.calls.avatar.length, 3);
    assert.equal(f.store.shoppers.view(f.a).store.dispatched, 3);
  }),
);

test(
  "invalid photos, failed verification and moderation rejection spend no image credits; rejected output is never delivered",
  fixture(async (f) => {
    const browser = await f.open();
    f.setGenerationMode("captcha");
    const headers = await f.authorize(browser);
    assert.equal(headers["X-Shopper-Proof"], undefined);
    assert.equal(f.calls.avatar.length, 0);
    f.setGenerationMode("");
    let proof = await f.authorize(browser);
    assert.equal(
      (
        await f.request("avatar", {
          ...browser,
          method: "POST",
          headers: proof,
          body: { ...f.avatarBody(), face: "data:image/svg+xml;base64,AAAA" },
        })
      ).status,
      400,
    );
    f.setGenerationMode("moderation");
    proof = await f.authorize(browser);
    assert.equal(
      (
        await f.request("avatar", {
          ...browser,
          method: "POST",
          headers: proof,
          body: f.avatarBody(),
        })
      ).status,
      422,
    );
    assert.equal(f.calls.avatar.length, 0);
    f.setGenerationMode("output-moderation");
    proof = await f.authorize(browser);
    const rejected = await f.request("avatar", {
      ...browser,
      method: "POST",
      headers: proof,
      body: f.avatarBody(),
    });
    assert.equal(rejected.status, 422);
    assert.ok(!(await rejected.text()).includes("data:image"));
    assert.equal(f.calls.avatar.length, 1);
    assert.equal(f.store.billing.balance(f.a.org), 1000);
  }),
);

test(
  "end and disconnect cancel in-flight HTTP generation, discard late bytes and refund once; product switching is blocked during work",
  fixture(async (f) => {
    const browser = await f.open(),
      headers = await f.authorize(browser);
    let release, started;
    const workStarted = new Promise((resolve) => {
      started = resolve;
    });
    f.holdGeneration(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    f.onGenerate(started);
    const request = f.request("avatar", {
      ...browser,
      method: "POST",
      headers,
      body: f.avatarBody(),
    });
    await workStarted;
    const choices = (await (await f.request("products", browser)).json()).products;
    assert.equal(
      (
        await f.request("product", {
          ...browser,
          method: "POST",
          body: { selection: choices[1].selection },
        })
      ).status,
      409,
    );
    assert.equal((await f.request("session", { ...browser, method: "DELETE" })).status, 204);
    const result = await request;
    assert.equal(result.status, 410);
    assert.ok(!(await result.text()).includes("data:image"));
    assert.equal(f.calls.avatar[0].signal.aborted, true);
    release();
    assert.equal(f.store.billing.balance(f.a.org), 1000);
    assert.equal(f.store.shoppers.view(f.a).store.dispatched, 1);
    assert.equal(f.store.db.prepare("SELECT count(*) n FROM image_call_leases").get().n, 0);
  }),
);

test(
  "HTTP client disconnect aborts the provider signal and cannot save or settle a late image",
  fixture(async (f) => {
    const browser = await f.open(),
      headers = await f.authorize(browser);
    let release, started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    f.holdGeneration(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    f.onGenerate(started);
    const controller = new AbortController();
    const pending = f
      .request("avatar", {
        ...browser,
        method: "POST",
        headers,
        body: f.avatarBody(),
        signal: controller.signal,
      })
      .catch((error) => error);
    await ready;
    controller.abort();
    await pending;
    for (let i = 0; i < 40 && !f.calls.avatar[0].signal.aborted; i++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(f.calls.avatar[0].signal.aborted, true);
    release();
    assert.equal(f.store.billing.balance(f.a.org), 1000);
    assert.equal(f.store.shoppers.view(f.a).store.dispatched, 1);
    assert.equal(f.store.db.prepare("SELECT count(*) n FROM avatars").get().n, 0);
  }),
);

test(
  "template, catalogue and verification assets require a shopper session and use no-store bounded formats",
  fixture(async (f) => {
    const browser = await f.open();
    assert.equal((await f.request("verification.js")).status, 401);
    for (const path of ["verification.js", "template?profile=regular&tone=deep"]) {
      const response = await f.request(path, browser);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.equal((await f.request("template?profile=f-regular&tone=deep", browser)).status, 400);
    const choices = (await (await f.request("products", browser)).json()).products;
    const image = await f.request("product-image?selection=" + choices[0].selection, browser);
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type"), /image\/jpeg/);
  }),
);

test(
  "oversized and compressed photo requests fail bounded parsing without dispatch or credit use",
  fixture(async (f) => {
    const browser = await f.open(),
      headers = await f.authorize(browser);
    const huge = await f.request("avatar", {
      ...browser,
      method: "POST",
      headers,
      body: { ...f.avatarBody(), face: "A".repeat(16 * 1024 * 1024) },
    });
    assert.equal(huge.status, 413);
    const compressed = await f.request("avatar", {
      ...browser,
      method: "POST",
      headers: { ...headers, "Content-Encoding": "gzip" },
      body: f.avatarBody(),
    });
    assert.equal(compressed.status, 415);
    assert.equal(f.calls.avatar.length, 0);
    assert.equal(f.store.billing.balance(f.a.org), 1000);
  }),
);

test("female body references require the existing opt-in and pass the selected template without changing the provider contract", async () => {
  const f = await workflowFixture({ appOptions: { femaleEnabled: true } });
  try {
    const browser = await f.open();
    assert.equal(browser.data.workflow.profiles.length, 8);
    const headers = await f.authorize(browser);
    const response = await f.request("avatar", {
      ...browser,
      method: "POST",
      headers,
      body: {
        ...f.avatarBody(),
        profileId: "f-regular",
        templateTone: "very-deep",
        measurements: { heightCm: 160, weightKg: 60 },
      },
    });
    assert.equal(response.status, 200);
    assert.equal(f.calls.avatar[0].profileId, "f-regular");
    assert.equal(f.calls.avatar[0].templateTone, "very-deep");
    assert.equal(f.calls.avatar[0].model, "gemini-2.5-flash-image");
  } finally {
    await f.close();
  }
});

test(
  "a verified slow upload occupies the shared slot before parsing and ending the session stops it without paid work",
  fixture(async (f) => {
    const browser = await f.open(),
      headers = await f.authorize(browser);
    let closed;
    const client = httpRequest(
      f.base + "/shopper-api/avatar",
      {
        method: "POST",
        headers: {
          Origin: publicStudio,
          Cookie: browser.cookie,
          "X-Shopper-CSRF": browser.csrf,
          ...headers,
          "Content-Type": "application/json",
          "Content-Length": "10000",
        },
      },
      (response) => response.resume(),
    );
    const stopped = new Promise((resolve) => {
      closed = resolve;
      client.once("close", resolve);
    });
    client.on("error", () => {});
    client.write("{");
    try {
      for (
        let i = 0;
        i < 50 && !f.store.db.prepare("SELECT 1 FROM image_call_leases WHERE kind='shopper'").get();
        i++
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(f.store.db.prepare("SELECT 1 FROM image_call_leases WHERE kind='shopper'").get());
      const denied = await fetch(f.base + "/shopper-api/avatar", {
        method: "POST",
        headers: {
          Origin: publicStudio,
          Cookie: browser.cookie,
          "X-Shopper-CSRF": browser.csrf,
          ...headers,
          "Content-Type": "application/json",
        },
        body: '{"private-photo":',
      });
      assert.equal(denied.status, 429);
      assert.ok(!(await denied.text()).includes("private-photo"));
      assert.equal((await f.request("session", { ...browser, method: "DELETE" })).status, 204);
      await stopped;
      assert.equal(f.calls.avatar.length, 0);
      assert.equal(f.calls.moderation.length, 0);
      assert.equal(f.store.billing.balance(f.a.org), 1000);
      assert.equal(f.store.db.prepare("SELECT count(*) n FROM image_call_leases").get().n, 0);
    } finally {
      client.destroy();
      closed();
    }
  }),
);
