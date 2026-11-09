import { test, expect } from "@playwright/test";
import { createGeminiModeration, DEFAULT_SAFETY_MODEL } from "../../server/gemini-moderation.js";
import { workflowFixture } from "../helpers/shopper-workflow.js";
import { responseForRequest } from "../helpers/gemini-safety.js";
import { publicStudio } from "../helpers/shopify-shopper.js";
import { customerPhotos } from "../helpers/customer-photos.js";

async function setup(page, run, { rejectStage } = {}) {
  const requests = [];
  let reject = rejectStage,
    closing = false;
  const moderation = createGeminiModeration({
      apiKey: "private-gemini-safety-browser-key",
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        const data = responseForRequest(options),
          content = JSON.parse(data.candidates[0].content.parts[0].text),
          stage = content.assessments[0].role === "result" ? "output" : "input";
        if (stage === reject) {
          content.assessments[0].uncertain = true;
          data.candidates[0].content.parts[0].text = JSON.stringify(content);
        }
        return new Response(JSON.stringify(data));
      },
    }),
    f = await workflowFixture({ sessionOptions: { moderation } });
  const proxy = async (route) => {
    try {
      const u = new URL(route.request().url()),
        response = await route.fetch({
          url: f.base + u.pathname + u.search,
          headers: {
            ...route.request().headers(),
            host: new URL(f.base).host,
            origin: u.pathname.startsWith("/api/") ? f.base : publicStudio,
          },
        });
      await route.fulfill({ response });
    } catch (error) {
      if (!closing && page.url() !== "about:blank") throw error;
    }
  };
  await page.route("**/api/**", proxy);
  await page.route("**/shopper", proxy);
  await page.route("**/shopper-api/**", proxy);
  try {
    await run({
      ...f,
      requests,
      allow: () => {
        reject = undefined;
      },
      launch: async () => page.goto("/shopper" + f.launch().hash),
    });
  } finally {
    closing = true;
    await page.goto("about:blank");
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
}
async function verify(page, tryon = false) {
  await page.getByRole("checkbox", { name: "I am 18 or older.", exact: true }).check();
  await page.getByRole("checkbox", { name: "These are my own photos", exact: false }).check();
  await page
    .getByRole("checkbox", {
      name: tryon ? "I request a separate AI clothing preview" : "I request an AI avatar",
      exact: false,
    })
    .check();
  await page
    .getByRole("button", {
      name: tryon ? "Verify this try-on" : "Verify and continue to photos",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText("Verified.");
}
async function photoInput(page) {
  await page.locator("#face-file").setInputFiles(customerPhotos[2].face);
  await page.locator("#body-file").setInputFiles(customerPhotos[2].body);
  await expect(page.getByRole("button", { name: "Generate my avatar", exact: true })).toBeEnabled();
}

test("mocked Gemini safety reviews both stages of an avatar and product preview without regenerating the approved avatar", async ({
  page,
}) =>
  setup(page, async (f) => {
    await f.launch();
    await verify(page);
    await photoInput(page);
    expect(f.requests.length).toBe(0);
    await page.getByRole("button", { name: "Generate my avatar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Approve avatar", exact: true })).toBeVisible();
    expect(f.requests.length).toBe(2);
    await page
      .getByRole("checkbox", {
        name: "I checked my face, complexion and proportions.",
        exact: true,
      })
      .check();
    await page.getByRole("button", { name: "Approve avatar", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Verify this try-on", exact: true }),
    ).toBeVisible();
    await verify(page, true);
    await page.getByRole("button", { name: "Try this product", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Review your look", exact: true }),
    ).toBeVisible();
    expect(f.requests.length).toBe(4);
    expect(f.calls.avatar.length).toBe(1);
    expect(f.calls.tryon.length).toBe(1);
    expect(f.store.billing.balance(f.a.org)).toBe(998);
  }));

for (const rejectStage of ["input", "output"])
  test(
    "a rejected " + rejectStage + " safety review cannot expose an avatar or cause automatic retry",
    async ({ page }) =>
      setup(
        page,
        async (f) => {
          await f.launch();
          await verify(page);
          await photoInput(page);
          await page.getByRole("button", { name: "Generate my avatar", exact: true }).click();
          await expect(page.getByRole("status")).toContainText(
            "did not pass the shopper safety checks",
          );
          await expect(page.locator("#avatar-result")).not.toHaveAttribute("src", /.*/);
          await expect(
            page.getByRole("checkbox", { name: "I am 18 or older.", exact: true }),
          ).not.toBeChecked();
          expect(f.calls.avatar.length).toBe(rejectStage === "input" ? 0 : 1);
          expect(f.store.billing.balance(f.a.org)).toBe(1000);
          expect(f.requests.length).toBe(rejectStage === "input" ? 1 : 2);
        },
        { rejectStage },
      ),
  );

test("owner diagnostics show the configured Gemini safety model while keeping live verification unapproved", async ({
  page,
}) =>
  setup(page, async (f) => {
    await page.goto("/");
    await page.getByLabel("Account email").fill("river@example.test");
    await page.getByLabel("Account password").fill("test-password-long");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await page.goto("/shopify-shopper");
    await page.setViewportSize({ width: 390, height: 844 });
    const report = page.getByRole("region", { name: "Shopper launch readiness", exact: true });
    await expect(report).toContainText(DEFAULT_SAFETY_MODEL);
    await expect(report).toContainText("Live verification still required");
    expect(f.requests.length).toBe(0);
    await report.screenshot({ path: "test-results/gemini-safety-readiness-mobile.png" });
  }));
