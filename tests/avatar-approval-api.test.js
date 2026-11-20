import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AccountStore } from "./helpers/pilot-accounts.js";
import { createApp, standardAvatar } from "../server/app.js";
import { AVATAR_REVIEW_CRITERIA } from "../src/avatar-quality-gates.js";

const review = () => ({
  customerApproved: true,
  customerConsent: true,
  reviewerConfirmed: true,
  scores: Object.fromEntries(AVATAR_REVIEW_CRITERIA.map((name) => [name, 4])),
});

test("account avatars remain draft until approved; reuse rejects drafts, revocation and foreign stores", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forme-server-approval-"));
  const store = new AccountStore(directory);
  const server = createApp({
    accountStore: store,
    accessMode: "public",
    apiKey: "test",
    rateLimit: false,
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (url, method = "GET", data, token = "", source = origin) =>
    fetch(origin + url, {
      method,
      headers: { origin: source, cookie: token, "Content-Type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  const login = async (email) => {
    const response = await request("/api/account/register", "POST", {
      email,
      password: "secure-testing-password-only",
      name: "Test Store",
    });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  try {
    const owner = await login("avatar-approval-owner@example.com");
    const foreign = await login("avatar-approval-other@example.com");
    const avatar = {
      name: "Customer approved master",
      image: "data:image/png;base64," + (await standardAvatar("regular")).toString("base64"),
      profileId: "regular",
      heightCm: 175,
      weightKg: 72,
      source: "imported",
      storageConsent: true,
    };
    const saved = await request("/api/avatars", "POST", avatar, owner);
    assert.equal(saved.status, 200);
    const { id, approvalStatus } = await saved.json();
    assert.equal(approvalStatus, "draft");
    const status = async () =>
      (await (await request("/api/avatars", "GET", undefined, owner)).json()).avatars[0]
        .approvalStatus;
    assert.equal(await status(), "draft");
    assert.equal((await request(`/api/avatars/${id}/image`, "GET", undefined, owner)).status, 200);

    const look = {
      avatarId: id,
      name: "Outfit",
      image: avatar.image,
      garments: ["Shirt"],
      storageConsent: true,
    };
    assert.equal((await request("/api/looks", "POST", look, owner)).status, 409);
    assert.equal((await request(`/api/avatars/${id}/views`, "GET", undefined, owner)).status !== 200, true);

    const wrong = await request(`/api/avatars/${id}/approval`, "POST", review(), foreign);
    assert.equal(wrong.status, 404);
    const missing = { ...review(), scores: { faceLikeness: 5 } };
    assert.equal((await request(`/api/avatars/${id}/approval`, "POST", missing, owner)).status, 400);
    assert.equal((await request(`/api/avatars/${id}/approval`, "POST", review(), owner, "https://evil.example")).status, 403);
    assert.equal(await status(), "draft");

    const approved = await request(`/api/avatars/${id}/approval`, "POST", review(), owner);
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).approvalStatus, "approved");
    assert.equal(await status(), "approved");
    assert.equal((await request("/api/looks", "POST", look, owner)).status, 200);

    const dbRow = store.db
      .prepare("SELECT approved_at,approved_by,review_policy FROM avatars WHERE account=? AND id=?")
      .get(store.user(owner.split("=")[1]).id, id);
    assert.equal(dbRow.review_policy, 1);
    assert.ok(dbRow.approved_at > 0);
    assert.equal(typeof dbRow.approved_by, "string");
    const raw = JSON.stringify(dbRow);
    assert.equal(raw.includes("faceLikeness"), false);

    const revoked = await request(`/api/avatars/${id}/approval`, "DELETE", undefined, owner);
    assert.equal(revoked.status, 200);
    assert.equal(await status(), "draft");
    assert.equal((await request("/api/looks", "POST", look, owner)).status, 409);

    const reapproved = await request(`/api/avatars/${id}/approval`, "POST", review(), owner);
    assert.equal(reapproved.status, 200);
    const renamed = await request("/api/avatars", "POST", { ...avatar, name: "Changed name" }, owner);
    assert.equal(renamed.status, 200);
    assert.equal(await status(), "draft", "a resaved avatar must be re-reviewed");

    const persisted = new AccountStore(directory);
    try {
      const identity = persisted.user(owner.split("=")[1]);
      assert.equal(persisted.list(identity)[0].approvalStatus, "draft");
    } finally {
      persisted.close();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
