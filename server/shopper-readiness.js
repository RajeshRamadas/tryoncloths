export const liveShopperChecks = [
  {
    id: "services",
    label: "Review verification/moderation services, tariffs, policy coverage and data terms",
  },
  { id: "legal", label: "Approve the actual merchant/provider disclosure and privacy process" },
  { id: "provider", label: "Verify Gemini billing, quota and avatar/garment output quality" },
  {
    id: "shopify-live",
    label: "Install and test the app, webhooks and draft theme in a Shopify development store",
  },
  {
    id: "deployment",
    label: "Check target Lightsail proxy, memory/load, tmpfs cleanup, swap and backup exclusions",
  },
  { id: "pilot", label: "Complete the real mobile walkthrough and owner-supervised opt-in pilot" },
];

// Local observations only. No provider calls, writes, credentials, customer data
// or raw adapter errors are returned, and no checklist item approves a launch.
export function shopperReadiness(shopify, account) {
  shopify.actor(account);
  const workflow = shopify.workflow,
    sessions = workflow?.sessions,
    configuration = workflow?.configuration() || {},
    checks = [];
  const check = (id, label, ok, detail) =>
    checks.push({ id, label, state: ok ? "pass" : "blocked", detail });
  let shopifyReady = false;
  try {
    shopify.ready();
    shopifyReady = true;
  } catch {}
  const source = shopify.configurationSource || {
    status: "injected",
    code: "programmatic_configuration",
  };
  check(
    "configuration-source",
    "Server service configuration",
    source.status === "loaded" || source.status === "injected",
    source.status === "invalid"
      ? "The server service module is invalid. Check its file, permissions and allowed exports."
      : source.status === "not-configured"
        ? "Load a reviewed server service module; environment flags alone are insufficient."
        : "Dependencies were loaded. Their live behavior and terms still require review.",
  );
  check(
    "sessions",
    "Temporary sessions enabled",
    Boolean(sessions?.enabled),
    "Set TRYON_SHOPPER_SESSIONS=true when the pilot is ready.",
  );
  check(
    "workflow",
    "Shopper workflow enabled",
    Boolean(workflow?.enabled),
    "Set TRYON_SHOPPER_WORKFLOW=true when the pilot is ready.",
  );
  check(
    "shopify-config",
    "Shopify and studio configuration",
    shopifyReady,
    "Configure the Shopify app, persistent secret key and public HTTPS studio address.",
  );
  check(
    "provider",
    "Gemini image configuration",
    Boolean(configuration.provider && configuration.adapters),
    "A key, supported model and existing image adapters must be configured; this does not test quota or quality.",
  );
  check(
    "captcha",
    "Server verification adapter",
    Boolean(
      typeof sessions?.captcha?.verify === "function" &&
      /^[a-z0-9-]{1,60}$/.test(sessions?.captcha?.id || ""),
    ),
    "Configure the verifier and matching browser widget; a site key alone cannot verify tokens.",
  );
  check(
    "captcha-client",
    "Browser verification configuration",
    Boolean(configuration.verificationClient),
    "The browser adapter must match the verifier and declare bounded public HTTPS CSP origins.",
  );
  check(
    "moderation",
    "Image safety adapter",
    Boolean(
      typeof sessions?.moderation?.check === "function" &&
      /^[a-z0-9-]{1,60}$/.test(sessions?.moderation?.id || ""),
    ),
    sessions?.moderation?.provider === "gemini"
      ? "Gemini image-safety review is configured. Its model, policy coverage, costs and data terms still need live review; appearance assessment does not verify age, identity or ownership."
      : "Supply a reviewed adapter enforcing the shopper input/output policy. Built-in face checks do not verify age or identity.",
  );
  check(
    "disclosure",
    "Disclosure and consent version",
    Boolean(configuration.disclosure),
    "Provide reviewed processing/purpose text, contact, HTTPS policy/terms and a matching revision.",
  );
  check(
    "proxy",
    "Trusted proxy and client-IP checks",
    Boolean(
      sessions &&
      !sessions.proxyError &&
      (sessions.trustProxy === 1 ? sessions.proxyCount > 0 : !shopify.production),
    ),
    "Production needs one reverse proxy with explicitly trusted peer CIDRs; direct development is not a live proxy test.",
  );
  const transient = shopify.state;
  let storage = false;
  try {
    storage = Boolean(transient?.owned);
    transient.db.prepare("SELECT count(*) FROM shopper_state").get();
  } catch {
    storage = false;
  }
  check(
    "storage",
    "Shared transient tmpfs store",
    storage,
    "Use the dedicated tmpfs directory outside account backups. An injected test database does not verify deployment storage.",
  );
  const row = shopify.row(account.id);
  check(
    "installation",
    "Shopify installation active",
    Boolean(row?.status === "installed" && row.credentials),
    "Install the dedicated app and verify the storefront domains.",
  );
  check(
    "widget",
    "Shopify button enabled",
    Boolean(row?.status === "installed" && row.enabled),
    "Enable the selected store’s button only when its setup is ready.",
  );
  const spending = shopify.store.shoppers.view(account);
  check(
    "subscription",
    "Eligible store subscription",
    spending.eligible,
    "Shopper generation requires an active Growth or Chain plan.",
  );
  check(
    "budget",
    "Owner allowances enabled",
    !spending.paused && spending.store.monthlyLimit > 0 && spending.organisation.monthlyLimit > 0,
    "Both monthly limits must be positive and shopper spending must be unpaused.",
  );
  const remaining = [spending.store, spending.organisation];
  check(
    "allowance",
    "Room for an avatar and first try-on",
    remaining.every(
      (s) => s.creditRemaining >= 2 && s.attemptRemaining >= 2 && s.moderationRemaining >= 4,
    ),
    "A fresh complete journey needs two image credits/attempts and four moderation invocations. Failures may reduce this allowance.",
  );
  check(
    "balance",
    "Shared AI credits available",
    shopify.store.billing.balance(account.org) >= 2,
    "Keep at least two AI credits for a new avatar plus its first product preview.",
  );
  let product = false;
  if (row?.status === "installed")
    for (const item of shopify.products(row)) {
      if (!item.enabled || !item.eligible) continue;
      try {
        shopify.launchContext(row, item.externalId.split("/").pop());
        product = true;
        break;
      } catch {}
    }
  check(
    "products",
    "An enabled product can launch",
    product,
    "Select a published, in-stock product with its clothing type confirmed in this installed shop.",
  );
  return {
    schemaVersion: 1,
    checkedAt: new Date(shopify.now()).toISOString(),
    scope: "local-configuration",
    configurationReady: checks.every((c) => c.state === "pass"),
    workflowConfigured: Boolean(workflow?.metadata()),
    liveVerified: false,
    checks,
    manualChecks: liveShopperChecks.map((c) => ({ ...c, state: "unverified" })),
    ...(sessions?.moderation?.provider === "gemini"
      ? {
          safety: {
            provider: "gemini",
            model: sessions.moderation.model,
            revision: sessions.moderation.revision,
          },
        }
      : {}),
  };
}
