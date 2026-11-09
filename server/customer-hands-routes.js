import { meter, validRequestId, BillingError } from "./billing.js";
import {
  generateCustomerHands,
  normalizeHandPhoto,
  requireCustomerHandPresence,
  requireCustomerHandsUnchanged,
  customerHandAnchors,
  validateCustomerHandPoints,
  customerHandsWarning,
  CUSTOMER_HANDS_CONTRACT,
} from "./customer-hands.js";
import { viewPng } from "./avatar-view-store.js";
import { validTemplateTone } from "../src/profiles.js";
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function installCustomerHandsRoutes(
  app,
  store,
  {
    wrap,
    session,
    provider,
    apiKey,
    model,
    femaleEnabled,
    rateLimit,
    hands = generateCustomerHands,
  } = {},
) {
  const views = store.views;
  let preflights = 0;
  app.get(
    "/api/avatars/:id/views/hands/anchors",
    wrap(async (req, res, account) => {
      const result = await views.handAnchors(account, req.params.id);
      session(req, account);
      res.json({ anchors: result, contract: CUSTOMER_HANDS_CONTRACT });
    }),
  );
  const create = wrap(async (req, res, account) => {
    const body = req.body,
      id = req.params.id;
    if (
      Object.keys(body).some(
        (k) =>
          ![
            "kind",
            "source",
            "tone",
            "handPhoto",
            "handPoints",
            "handsConfirmed",
            "avatarReviewed",
            "consent",
            "consentScope",
            "consentProvider",
            "requestId",
          ].includes(k),
      )
    )
      throw fail("Use only the supported customer hand photo fields.");
    if (provider !== "gemini" || !apiKey)
      throw fail("Customer hand cleanup requires the configured Gemini image service.", 503);
    const context = views.context(account, id, "hands"),
      tone = body.tone ?? context.avatar.template_tone;
    if (context.avatar.body_type === "female" && !femaleEnabled)
      throw fail("Female customer hand generation is not enabled on this studio.");
    if (!validTemplateTone(tone))
      throw fail("Choose a valid tone reference. The photo’s actual complexion is preserved.");
    if (body.handsConfirmed !== true || body.avatarReviewed !== true)
      throw fail(
        "Confirm the customer’s own two hands, complete fingers/wrists and all twelve placement markers, and the matching approved avatar.",
      );
    if (
      body.consent !== true ||
      body.consentScope !== "hands-for-cleanup" ||
      body.consentProvider !== "gemini"
    )
      throw fail(
        "Customer consent to send this hand photo to Gemini for one cleanup using 1 AI credit is required.",
      );
    let points;
    try {
      points = validateCustomerHandPoints(body.handPoints);
    } catch {
      throw fail("Mark all fingers and wrists on this photo before generation.");
    }
    const anchors = customerHandAnchors(points);
    if (!validRequestId(body.requestId))
      throw new BillingError(
        "invalid_request_id",
        "Each customer hand cleanup needs a fresh UUID v4 requestId.",
        400,
      );
    if (
      store.db
        .prepare("SELECT 1 FROM ledger WHERE org=? AND requestId=?")
        .get(account.org, body.requestId.toLowerCase())
    )
      throw new BillingError(
        "duplicate_request",
        "This hand request was already submitted. Check its preview; no automatic retry was made.",
      );
    let photo, job, timer;
    const cancelled = new AbortController();
    const stop = () => {
      if (!res.writableEnded)
        cancelled.abort(
          fail(
            "Hand cleanup stopped. No automatic retry was sent; the provider may still charge.",
            409,
          ),
        );
    };
    req.on("aborted", stop);
    res.on("close", stop);
    const live = () => {
      if (cancelled.signal.aborted) throw cancelled.signal.reason;
      session(req, account);
      views.current(account, id, "hands", context);
      if (
        store.db.prepare("SELECT status FROM orgs WHERE id=?").get(account.org)?.status ===
        "suspended"
      )
        throw new BillingError("account_suspended", "This organisation is suspended.", 403);
      if (job) views.job(account, id, "hands", job);
    };
    try {
      job = views.acquire(account, id, "hands");
      if (preflights >= 2)
        throw new BillingError(
          "image_busy",
          "Other hand photos are being checked. Try again shortly.",
          429,
        );
      preflights++;
      try {
        photo = await normalizeHandPhoto(body.handPhoto);
        delete body.handPhoto;
        await requireCustomerHandPresence(photo, anchors);
      } finally {
        preflights--;
      }
      live();
      timer = setInterval(() => {
        try {
          live();
        } catch (e) {
          cancelled.abort(e);
        }
      }, 150);
      timer.unref();
      let receipt;
      const image = await meter(
        req,
        {
          billing: store.billing,
          account,
          action: "avatar",
          beforeReserve: () => {
            live();
            if (rateLimit) {
              const u = store.db
                .prepare(
                  "SELECT count(*) n,max(createdAt) last FROM ledger WHERE org=? AND store=? AND user=? AND pool='ai' AND kind='hold' AND action='avatar' AND createdAt>?",
                )
                .get(account.org, account.id, account.user.id, Date.now() - 3600000);
              if (u.n >= 20 || (u.last && Date.now() - u.last < 15000))
                throw new BillingError(
                  "portrait_rate_limit",
                  "Wait before generating again. The pilot allows 20 avatar/view attempts per hour and 15 seconds between attempts.",
                  429,
                );
            }
          },
          beforeCommit: (output) => {
            live();
            receipt = views.receipt(account, id, "hands", context, output, {
              tone,
              sourceKind: "photo",
              handPoints: points,
            });
          },
        },
        () =>
          store.imageSlots.run({ kind: "staff", signal: cancelled.signal }, async (signal) => {
            live();
            const output = await hands({ handPhoto: photo, points, apiKey, model, signal });
            live();
            const bytes = await viewPng(output, "hands");
            try {
              await requireCustomerHandsUnchanged(photo, bytes, anchors);
            } finally {
              bytes.fill(0);
            }
            live();
            return output;
          }),
      );
      res.json({
        image,
        receipt,
        kind: "hands",
        sourceKind: "photo",
        tone,
        contract: CUSTOMER_HANDS_CONTRACT,
        anchors,
        needsReview: true,
        creditsUsed: 1,
        warnings: [{ code: "hands_heuristic", message: customerHandsWarning }],
      });
    } finally {
      clearInterval(timer);
      req.off("aborted", stop);
      res.off("close", stop);
      if (job) views.release(job);
      photo?.fill(0);
      delete body.handPhoto;
      delete body.handPoints;
    }
  });
  app.post("/api/avatars/:id/views", (req, res, next) =>
    req.body?.kind === "hands" && req.body?.source === "photo" ? create(req, res) : next(),
  );
}
