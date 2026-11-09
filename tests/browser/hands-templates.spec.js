import { test, expect } from "@playwright/test";
import { skinTones } from "../../src/profiles.js";

test("all twelve shipped hands images and anchors load in the browser without generation requests", async ({
  page,
}) => {
  const calls = [];
  page.on("request", (r) => {
    if (/\/api\/(?:personalize|tryon|jewellery\/tryon)/.test(r.url())) calls.push(r.url());
  });
  await page.goto("/hands/male-medium.png");
  for (const body of ["male", "female"])
    for (const tone of skinTones) {
      const url = "/hands/" + body + "-" + tone.id;
      const image = await page.request.get(url + ".png");
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toContain("image/png");
      const anchors = await page.request.get(url + ".json");
      expect(anchors.status()).toBe(200);
      expect((await anchors.json()).left.ring.widthPx).toBeGreaterThanOrEqual(30);
      const dimensions = await page.evaluate(async (url) => {
        const img = await createImageBitmap(await (await fetch(url)).blob());
        const result = [img.width, img.height];
        img.close();
        return result;
      }, url + ".png");
      expect(dimensions).toEqual([1024, 1024]);
    }
  expect(calls).toEqual([]);
});
