import { test, expect } from "@playwright/test";
import path from "node:path";
import { customerPhotos } from "../helpers/customer-photos.js";

test("each standard template's build suggests its own profile", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { measureBodyBuild } = await import("/src/body-pose.ts");
    const { suggestBuild } = await import("/src/body-build.js");
    const { avatarCanvas } = await import("/src/images.ts");
    const { profiles } = await import("/src/profiles.js");
    const out = [];
    for (const p of profiles) {
      const build = await measureBodyBuild((await avatarCanvas(p.index)).toDataURL());
      out.push([p.id, suggestBuild(build, p.body)?.profileId]);
    }
    return out;
  });
  for (const [id, suggested] of results) expect(suggested, id).toBe(id);
});

test("staff see the build the full-body photo suggests and can use it", async ({ page }) => {
  test.setTimeout(90_000);
  const uploads = [];
  page.on("request", (req) => {
    if (req.method() !== "GET") uploads.push(req.url());
  });
  await page.goto("/");
  await page
    .getByRole("checkbox", {
      name: "The customer agrees to use their photos for this avatar session.",
    })
    .check();
  // A heavy-set customer in a loose shirt.
  await page
    .getByLabel("Upload full-body photo")
    .setInputFiles(path.resolve(customerPhotos[0].body));
  const estimate = page.getByLabel("Build from the photo");
  await expect(estimate).toContainText("closest to Broad", { timeout: 30_000 });
  await page.getByRole("button", { name: "Use the photo’s build" }).click();
  await expect(page.getByRole("button", { name: "Select Broad profile" })).toHaveClass(/selected/);
  await expect(page.getByRole("button", { name: "Use the photo’s build" })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove full-body photo" }).click();
  await expect(estimate).toHaveCount(0);
  expect(uploads).toEqual([]);
});
