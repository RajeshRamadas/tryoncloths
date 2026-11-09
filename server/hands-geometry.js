import { customerHandAnchors, validateCustomerHandPoints } from "./customer-hands.js";
import { handsTemplate } from "./hands-templates.js";
const fail = () =>
  Object.assign(
    new Error(
      "This hands image has no valid placement geometry. Reopen its approved view before fitting jewellery.",
    ),
    { status: 409 },
  );
export async function resolveHandsGeometry(
  store,
  account,
  avatarId,
  packet,
  { requirePacket = false } = {},
) {
  try {
    if (requirePacket && packet === undefined) throw fail();
    if (packet === undefined) {
      const view = store.views.get(account, avatarId, "hands"),
        avatar = store.views.avatar(account, avatarId);
      packet =
        view.sourceKind === "photo"
          ? { sourceKind: "photo", points: JSON.parse(view.handPointsJson) }
          : { sourceKind: view.sourceKind, body: avatar.body_type, tone: view.tone };
    }
    if (!packet || typeof packet !== "object" || Array.isArray(packet)) throw fail();
    if (packet.sourceKind === "photo") {
      if (Object.keys(packet).some((k) => !["sourceKind", "points"].includes(k))) throw fail();
      const points = validateCustomerHandPoints(packet.points);
      return {
        packet: { sourceKind: "photo", points },
        anchors: customerHandAnchors(points),
        sourceKind: "photo",
      };
    }
    if (
      packet.sourceKind !== "template" ||
      Object.keys(packet).some((k) => !["sourceKind", "body", "tone"].includes(k))
    )
      throw fail();
    const t = await handsTemplate(packet.body, packet.tone);
    return {
      packet: { sourceKind: "template", body: t.body, tone: t.tone },
      anchors: t.anchors,
      sourceKind: "template",
    };
  } catch {
    throw fail();
  }
}
