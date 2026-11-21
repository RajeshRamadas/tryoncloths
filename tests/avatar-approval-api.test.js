import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
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
    const historyUrl = `/api/avatars/${id}/versions`;
    const history = async (query = "") => {
      const response = await request(historyUrl + query, "GET", undefined, owner);
      assert.equal(response.status, 200);
      return response.json();
    };
    assert.deepEqual(await history(), { versions: [], nextBefore: null });
    assert.equal((await request(historyUrl, "GET", undefined, foreign)).status, 404);
    assert.equal((await request(historyUrl)).status, 401);
    assert.equal((await request(historyUrl + "?before=0", "GET", undefined, owner)).status, 400);
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
    assert.equal(
      (await request(`/api/avatars/${id}/views`, "GET", undefined, owner)).status !== 200,
      true,
    );

    const wrong = await request(`/api/avatars/${id}/approval`, "POST", review(), foreign);
    assert.equal(wrong.status, 404);
    const missing = { ...review(), scores: { faceLikeness: 5 } };
    assert.equal(
      (await request(`/api/avatars/${id}/approval`, "POST", missing, owner)).status,
      400,
    );
    assert.equal(
      (
        await request(
          `/api/avatars/${id}/approval`,
          "POST",
          review(),
          owner,
          "https://evil.example",
        )
      ).status,
      403,
    );
    assert.equal(await status(), "draft");

    const approvals = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(`/api/avatars/${id}/approval`, "POST", review(), owner),
      ),
    );
    for (const response of approvals) assert.equal(response.status, 200);
    const [approved, duplicate] = await Promise.all(approvals.map((r) => r.json()));
    assert.equal(approved.approvalStatus, "approved");
    assert.equal(approved.version, 1);
    assert.deepEqual(duplicate, approved);
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
    const identity = store.user(owner.split("=")[1]);
    const committedImage = await (
      await request(`/api/avatars/${id}/image`, "GET", undefined, owner)
    ).arrayBuffer();
    const firstPage = await history();
    assert.equal(firstPage.versions.length, 1);
    const [first] = firstPage.versions;
    assert.equal(
      first.imageSha256,
      createHash("sha256").update(Buffer.from(committedImage)).digest("hex"),
    );
    assert.equal(first.current, true);
    assert.equal(first.approvedBy, identity.user.id);
    assert.equal(first.approvedAt, approved.approvedAt);
    assert.equal(first.reviewPolicy, 1);
    assert.equal(first.profileId, "regular");
    assert.equal(first.heightCm, 175);
    assert.equal(Object.hasOwn(first, "scores"), false);
    assert.throws(
      () =>
        store.db
          .prepare("UPDATE avatar_versions SET metadata='{}' WHERE account=? AND avatarId=?")
          .run(identity.id, id),
      /versions are immutable/,
    );
    assert.throws(
      () =>
        store.db
          .prepare("UPDATE avatars SET image=? WHERE account=? AND id=?")
          .run(Buffer.from("different"), identity.id, id),
      /PNGs are immutable/,
    );

    const revoked = await request(`/api/avatars/${id}/approval`, "DELETE", undefined, owner);
    assert.equal(revoked.status, 200);
    assert.equal(await status(), "draft");
    assert.deepEqual((await history()).versions, [{ ...first, current: false }]);
    assert.equal((await request("/api/looks", "POST", look, owner)).status, 409);

    const reapproved = await request(`/api/avatars/${id}/approval`, "POST", review(), owner);
    assert.equal(reapproved.status, 200);
    assert.equal((await reapproved.json()).version, 2);
    const renamed = await request(
      "/api/avatars",
      "POST",
      { ...avatar, name: "Changed name", heightCm: 176 },
      owner,
    );
    assert.equal(renamed.status, 200);
    assert.equal(await status(), "draft", "a resaved avatar must be re-reviewed");

    const persisted = new AccountStore(directory);
    try {
      assert.equal(persisted.list(identity)[0].approvalStatus, "draft");
      const updated = persisted.approveAvatar(identity, id, review());
      assert.equal(updated.version, 3);
      const [newest, previous, original] = persisted.avatarVersions(identity, id).versions;
      assert.equal(newest.current, true);
      assert.equal(newest.name, "Changed name");
      assert.equal(newest.heightCm, 176);
      assert.equal(newest.imageSha256, first.imageSha256);
      assert.equal(previous.name, avatar.name);
      assert.equal(previous.current, false);
      assert.deepEqual(original, { ...first, current: false });
    } finally {
      persisted.close();
    }
    for (let n = 4; n <= 21; n++) {
      store.revokeAvatarApproval(identity, id);
      assert.equal(store.approveAvatar(identity, id, review()).version, n);
    }
    const latest = await history();
    assert.equal(latest.versions.length, 20);
    assert.equal(latest.nextBefore, 2);
    assert.deepEqual(await history("?before=2"), {
      versions: [{ ...first, current: false }],
      nextBefore: null,
    });
    assert.equal((await request(`/api/avatars/${id}`, "DELETE", undefined, owner)).status, 200);
    assert.equal(
      store.db
        .prepare("SELECT count(*) AS n FROM avatar_versions WHERE account=? AND avatarId=?")
        .get(identity.id, id).n,
      0,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
