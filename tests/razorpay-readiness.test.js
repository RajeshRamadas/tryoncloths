import assert from "node:assert/strict";
import test from "node:test";
import { checkRazorpayReadiness, paymentConfig } from "../server/payments.js";

const config = paymentConfig({
  RAZORPAY_KEY_ID: "rzp_test_fixture",
  RAZORPAY_KEY_SECRET: "fixture-api-secret",
  RAZORPAY_WEBHOOK_SECRET: "fixture-webhook-secret",
  RAZORPAY_PLAN_STARTER: "plan_starterMonthly",
  RAZORPAY_PLAN_STARTER_ANNUAL: "plan_starterAnnual",
  RAZORPAY_PLAN_GROWTH: "plan_growthMonthly",
  RAZORPAY_PLAN_GROWTH_ANNUAL: "plan_growthAnnual",
  RAZORPAY_PLAN_CHAIN: "plan_chainMonthly",
  RAZORPAY_PLAN_CHAIN_ANNUAL: "plan_chainAnnual",
  FORME_LEGAL_NAME: "Sample Supplier",
  FORME_ADDRESS: "Bengaluru, Karnataka",
  FORME_BILLING_EMAIL: "billing@example.test",
  FORME_STATE_CODE: "29",
  FORME_GSTIN: "29ABCDE1234F1Z5",
});

const plans = {
  plan_starterMonthly: [235882, "monthly"],
  plan_starterAnnual: [2358820, "yearly"],
  plan_growthMonthly: [707882, "monthly"],
  plan_growthAnnual: [7078820, "yearly"],
  plan_chainMonthly: [1769882, "monthly"],
  plan_chainAnnual: [17698820, "yearly"],
};

function providerPlan(id) {
  const [amount, period] = plans[id];
  return { id, item: { amount, currency: "INR" }, period, interval: 1 };
}

test("Razorpay readiness validates the six configured plans with authenticated GETs", async () => {
  const calls = [];
  const report = await checkRazorpayReadiness("test", {
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json(providerPlan(url.split("/").at(-1)));
    },
  });

  assert.equal(report.ready, true);
  assert.equal(report.mode, "test");
  assert.deepEqual(
    report.checks.map(({ state }) => state),
    Array(9).fill("pass"),
  );
  assert.deepEqual(
    calls.map(({ url }) => url),
    Object.keys(plans).map((id) => `https://api.razorpay.com/v1/plans/${id}`),
  );
  for (const { options } of calls) {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.body, undefined);
    assert.equal(
      options.headers.Authorization,
      `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`,
    );
  }
  const text = JSON.stringify(report);
  for (const privateValue of [
    config.keyId,
    config.keySecret,
    config.webhookSecret,
    config.planIds["starter:monthly"],
    config.supplier.gstin,
    config.supplier.billingEmail,
  ])
    assert.ok(!text.includes(privateValue));
});

test("Razorpay readiness skips provider requests when credentials are in the wrong mode", async () => {
  let requests = 0;
  const report = await checkRazorpayReadiness("live", {
    config: {
      ...config,
      webhookSecret: config.keySecret,
      supplier: { ...config.supplier, stateCode: "27" },
    },
    fetchImpl: async () => requests++,
  });

  assert.equal(requests, 0);
  assert.equal(report.ready, false);
  assert.deepEqual(
    report.checks.slice(0, 3).map(({ code }) => code),
    ["key_missing_or_wrong_mode", "separate_webhook_secret_required", "supplier_details_invalid"],
  );
  assert.ok(report.checks.slice(3).every(({ state }) => state === "skipped"));
});

test("Razorpay readiness reports invalid plan data and provider failures without raw diagnostics", async () => {
  const report = await checkRazorpayReadiness("test", {
    config: { ...config, planIds: { ...config.planIds, "chain:annual": "" } },
    fetchImpl: async (url) => {
      const id = url.split("/").at(-1);
      if (id === "plan_starterMonthly") return Response.json({ ...providerPlan(id), interval: 2 });
      if (id === "plan_starterAnnual")
        return Response.json({ ...providerPlan(id), item: { amount: 1999000, currency: "INR" } });
      if (id === "plan_growthMonthly")
        return new Response("private provider account details", { status: 403 });
      if (id === "plan_growthAnnual") throw new Error("private provider network details");
      return Response.json(providerPlan(id));
    },
  });

  assert.equal(report.ready, false);
  assert.deepEqual(
    Object.fromEntries(report.checks.slice(3).map(({ id, state, code }) => [id, code || state])),
    {
      "starter:monthly": "plan_configuration",
      "starter:annual": "plan_configuration",
      "growth:monthly": "payment_provider_error",
      "growth:annual": "payment_provider_unavailable",
      "chain:monthly": "pass",
      "chain:annual": "plan_id_invalid",
    },
  );
  assert.doesNotMatch(JSON.stringify(report), /private provider/);
});
