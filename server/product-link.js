import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import zlib from "node:zlib";
import sharp from "sharp";

// Reads a public product page and returns candidate garment images.
// Every hop (including redirects) is resolved and connected through a lookup
// that refuses private, loopback, link-local and reserved addresses, so the
// studio cannot be used to reach its own network or cloud metadata services.

export class LinkError extends Error {
  constructor(code) {
    super(linkMessages[code] || linkMessages.unknown);
    this.code = Object.hasOwn(linkMessages, code) ? code : "unknown";
  }
}

const linkMessages = {
  invalid_url: "Paste a full product link starting with https:// or http://.",
  blocked_address: "This link points to a private or local address and cannot be opened.",
  site_refused: "This website didn't allow the studio to read the page. Save the product image and upload it instead.",
  not_found: "The product page was not found. Check the link.",
  too_large: "The product page is too large to read.",
  timeout: "The website took too long to respond. Try again or upload the product image.",
  network: "The studio could not reach this website. Check the link or upload the product image.",
  no_images: "No product images were found on this page. Save the product image and upload it instead.",
  unknown: "The product link could not be read. Upload the product image instead.",
};

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001::", 23], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
]) blocked.addSubnet(address, prefix, "ipv6");

export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (!family) return false;
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]);
    if (/^::ffff:/i.test(address)) return false;
    return !blocked.check(address, "ipv6");
  }
  return !blocked.check(address, "ipv4");
}

export function parseProductUrl(raw) {
  if (typeof raw !== "string" || raw.length > 2048) throw new LinkError("invalid_url");
  let url;
  try { url = new URL(raw.trim()); } catch { throw new LinkError("invalid_url"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname)
    throw new LinkError("invalid_url");
  if (url.port && !["80", "443"].includes(url.port)) throw new LinkError("blocked_address");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublicAddress(host)) throw new LinkError("blocked_address");
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new LinkError("blocked_address");
  url.hash = "";
  return url;
}

function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address)))
      return callback(Object.assign(new Error("Blocked address"), { code: "EBLOCKED" }));
    if (options?.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

const userAgent = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 FormeStudio/1.0";

function requestOnce(url, { maxBytes, accept, deadline }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new LinkError("timeout"));
    const req = client.request(url, {
      method: "GET",
      lookup: guardedLookup,
      headers: { "User-Agent": userAgent, Accept: accept, "Accept-Language": "en-IN,en;q=0.9", "Accept-Encoding": "gzip, deflate, br" },
      timeout: remaining,
    }, res => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: res.headers.location });
      }
      if (status === 404 || status === 410) { res.resume(); return reject(new LinkError("not_found")); }
      if (status < 200 || status >= 300) { res.resume(); return reject(new LinkError("site_refused")); }
      const declared = Number(res.headers["content-length"]);
      if (declared > maxBytes) { res.destroy(); return reject(new LinkError("too_large")); }
      const encoding = String(res.headers["content-encoding"] || "").toLowerCase();
      const stream = encoding === "gzip" ? res.pipe(zlib.createGunzip())
        : encoding === "deflate" ? res.pipe(zlib.createInflate())
        : encoding === "br" ? res.pipe(zlib.createBrotliDecompress()) : res;
      const chunks = [];
      let size = 0;
      stream.on("data", chunk => {
        size += chunk.length;
        if (size > maxBytes) { res.destroy(); stream.destroy?.(); reject(new LinkError("too_large")); return; }
        chunks.push(chunk);
      });
      stream.on("end", () => resolve({ body: Buffer.concat(chunks), type: String(res.headers["content-type"] || "").toLowerCase() }));
      stream.on("error", () => reject(new LinkError("network")));
    });
    req.on("timeout", () => req.destroy(new LinkError("timeout")));
    req.on("error", error => reject(error instanceof LinkError ? error
      : error.code === "EBLOCKED" ? new LinkError("blocked_address")
      : new LinkError("network")));
    req.end();
  });
}

export async function safeFetch(raw, { maxBytes = 3 * 1024 * 1024, accept = "*/*", timeoutMs = 12000, maxRedirects = 4 } = {}) {
  let url = typeof raw === "string" ? parseProductUrl(raw) : raw;
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const result = await requestOnce(url, { maxBytes, accept, deadline });
    if (!result.redirect) return { ...result, url };
    let next;
    try { next = new URL(result.redirect, url); } catch { throw new LinkError("network"); }
    url = parseProductUrl(next.href);
  }
  throw new LinkError("network");
}

const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#x27": "'", "#x2F": "/", "#47": "/" };
const decode = value => value.replace(/&(#?\w+);/g, (match, name) => entities[name] ?? entities[name.toLowerCase()] ?? match);

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g))
    result[match[1].toLowerCase()] = decode(match[3] ?? match[4] ?? match[5] ?? "");
  return result;
}

function jsonLdImages(node, found, names, depth = 0) {
  if (!node || depth > 8) return;
  if (Array.isArray(node)) { for (const item of node) jsonLdImages(item, found, names, depth + 1); return; }
  if (typeof node !== "object") return;
  const types = [].concat(node["@type"] || []).map(String);
  if (types.some(type => /product/i.test(type))) {
    if (typeof node.name === "string") names.push(node.name);
    for (const image of [].concat(node.image || [])) {
      if (typeof image === "string") found.push(image);
      else if (image && typeof image === "object") found.push(image.contentUrl || image.url);
    }
  }
  for (const key of ["@graph", "mainEntity", "itemOffered", "hasVariant", "isVariantOf"]) jsonLdImages(node[key], found, names, depth + 1);
}

export function extractProduct(html, pageUrl) {
  const text = String(html).slice(0, 3 * 1024 * 1024);
  const productImages = [], metaImages = [], names = [];
  let ogTitle = "";
  for (const match of text.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { jsonLdImages(JSON.parse(match[1].trim()), productImages, names); } catch { /* ignore malformed blocks */ }
  }
  for (const match of text.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (["og:image", "og:image:secure_url", "og:image:url", "twitter:image", "twitter:image:src", "image"].includes(key) && attrs.content) metaImages.push(attrs.content);
    if (["og:title", "twitter:title"].includes(key) && attrs.content && !ogTitle) ogTitle = attrs.content;
  }
  for (const match of text.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if (/(^|\s)image_src(\s|$)/i.test(attrs.rel || "") && attrs.href) metaImages.push(attrs.href);
  }
  const titleTag = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(text)?.[1];
  const title = decode(names[0] || ogTitle || titleTag || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const images = [];
  for (const candidate of [...productImages, ...metaImages]) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    try {
      const url = new URL(decode(candidate.trim()), pageUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      if (!images.includes(url.href)) images.push(url.href);
    } catch { /* skip invalid */ }
    if (images.length >= 8) break;
  }
  return { title, images };
}

export async function normalizeGarmentImage(bytes) {
  const image = sharp(bytes, { limitInputPixels: 30_000_000, animated: false });
  const meta = await image.metadata();
  if (!["jpeg", "png", "webp", "avif", "gif"].includes(meta.format) || !meta.width || !meta.height || meta.width < 160 || meta.height < 160)
    throw new Error("unsupported image");
  return image.rotate().flatten({ background: "#ffffff" })
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
}

export async function readProductLink(raw, { fetchImpl = safeFetch } = {}) {
  const url = parseProductUrl(raw);
  const page = await fetchImpl(url, { accept: "text/html,application/xhtml+xml,image/*;q=0.8", maxBytes: 4 * 1024 * 1024 });
  let product;
  if (page.type.startsWith("image/")) product = { title: "", images: [page.url.href], direct: page.body };
  else product = extractProduct(page.body.toString("utf8"), page.url);
  if (!product.images.length) throw new LinkError("no_images");
  const results = await Promise.allSettled(product.images.slice(0, 6).map(async (source, index) => {
    const bytes = index === 0 && product.direct ? product.direct
      : (await fetchImpl(source, { accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5", maxBytes: 10 * 1024 * 1024, timeoutMs: 15000 })).body;
    const normalized = await normalizeGarmentImage(bytes);
    return { source, image: `data:image/jpeg;base64,${normalized.toString("base64")}` };
  }));
  const images = results.filter(result => result.status === "fulfilled").map(result => result.value);
  if (!images.length) throw new LinkError("no_images");
  return { title: product.title, url: page.url.href, images };
}
