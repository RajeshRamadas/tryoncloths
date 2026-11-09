import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
function secretKey(value = process.env.TRYON_SECRET_KEY) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value))
    throw Object.assign(new Error("Configure TRYON_SECRET_KEY as 32 random bytes in hex."), {
      status: 503,
    });
  return Buffer.from(value, "hex");
}
export function encrypt(plain, key, aad = "") {
  if (typeof plain !== "string" || !plain || plain.length > 4096)
    throw Object.assign(new Error("Use a valid integration token."), { status: 400 });
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", secretKey(key), iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), data.toString("hex")].join(
    ":",
  );
}
export function decrypt(value, key, aad = "") {
  try {
    const [version, iv, tag, data, ...extra] = value.split(":");
    if (
      version !== "v1" ||
      extra.length ||
      !/^\w{24}$/.test(iv) ||
      !/^\w{32}$/.test(tag) ||
      !data ||
      !/^[a-f0-9]+$/i.test(iv + tag + data)
    )
      throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", secretKey(key), Buffer.from(iv, "hex"));
    cipher.setAAD(Buffer.from(aad));
    cipher.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([cipher.update(Buffer.from(data, "hex")), cipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw Object.assign(
      new Error("Integration token could not be opened. Ask the owner to reconnect WhatsApp."),
      { status: 503 },
    );
  }
}
