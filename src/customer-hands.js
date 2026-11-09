// Customer-photo coordinates are authored on the normalised 1024px square.
// Never initialise them from a standard avatar's hand anchors.
export const customerHandPositions = ["thumb", "index", "middle", "ring", "little", "wrist"];
export const handMarkerIds = ["left", "right"].flatMap((side) =>
  customerHandPositions.map((finger) => side + "." + finger),
);
export function validateCustomerHandPoints(input) {
  const fail = () => {
    throw new Error(
      "Mark all five fingers and the wrist on each hand, with in-frame band widths and angles.",
    );
  };
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 12 ||
    Object.keys(input).some((k) => !handMarkerIds.includes(k))
  )
    fail();
  const result = Object.fromEntries(
    handMarkerIds.map((id) => {
      const p = input[id],
        wrist = id.endsWith(".wrist"),
        left = id.startsWith("left.");
      if (
        !p ||
        typeof p !== "object" ||
        Array.isArray(p) ||
        Object.keys(p).length !== 4 ||
        !["x", "y", "angle", "widthPx"].every(
          (k) => Object.hasOwn(p, k) && Number.isFinite(p[k]),
        ) ||
        p.angle < -180 ||
        p.angle > 180 ||
        p.widthPx < (wrist ? 120 : 30) ||
        p.widthPx > (wrist ? 300 : 90)
      )
        fail();
      const angle = (p.angle * Math.PI) / 180;
      for (const sign of [-1, 1]) {
        const x = p.x + (sign * Math.cos(angle) * p.widthPx) / 2,
          y = p.y + (sign * Math.sin(angle) * p.widthPx) / 2;
        if (x < (left ? 1 : 513) || x > (left ? 510 : 1022) || y < 1 || y > 1022) fail();
      }
      return [id, { x: p.x, y: p.y, angle: p.angle, widthPx: p.widthPx }];
    }),
  );
  // Distinct labelled bands must not collapse onto one skin-coloured spot.
  for (const side of ["left", "right"]) {
    const points = customerHandPositions.map((f) => result[side + "." + f]);
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++)
        if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < 25) fail();
    if (points[5].y < Math.max(...points.slice(0, 5).map((p) => p.y)) + 100) fail();
  }
  return result;
}
function hull(points) {
  const sorted = points.sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const lower = [],
    upper = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
export function customerHandAnchors(input) {
  const points = validateCustomerHandPoints(input),
    hands = {},
    polygons = [];
  for (const side of ["left", "right"]) {
    const left = side === "left",
      corners = [];
    hands[side] = {};
    for (const finger of customerHandPositions) {
      const p = points[side + "." + finger];
      hands[side][finger] = p;
      // A conservative region around the authored bands, not an anatomy model.
      for (const dx of [-p.widthPx * 0.65, p.widthPx * 0.65])
        for (const dy of [-85, 85])
          corners.push([
            Math.max(left ? 1 : 513, Math.min(left ? 510 : 1022, p.x + dx)),
            Math.max(1, Math.min(1022, p.y + dy)),
          ]);
    }
    polygons.push(hull(corners));
  }
  // Retracing the connecting edge gives two disjoint filled polygons in the
  // existing single-polygon format; the centre background is not a hand.
  const [a, b] = polygons;
  return {
    schemaVersion: 1,
    width: 1024,
    height: 1024,
    left: hands.left,
    right: hands.right,
    handMask: [...a, a[0], ...b, b[0], a[0]],
  };
}
