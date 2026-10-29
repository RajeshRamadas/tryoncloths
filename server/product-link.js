import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import sharp from "sharp";
import { LinkError } from "./link-errors.js";
import { parseProductUrl, guardedLookup } from "./public-url.js";
export { LinkError } from "./link-errors.js";
export { parseProductUrl, isPublicAddress } from "./public-url.js";

// Reads a public product page and returns candidate garment images.
// Every hop (including redirects) is resolved and connected through a lookup
// that refuses private, loopback, link-local and reserved addresses, so the
// studio cannot be used to reach its own network or cloud metadata services.

const userAgent = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 FormeStudio/1.0";

function requestOnce(url, { maxBytes, accept, deadline }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new LinkError("timeout"));
    let response, stream, settled=false, timer;
    const finish=(error,result)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      if(error || result?.redirect){response?.destroy();if(stream!==response)stream?.destroy();req.destroy();}
      if(error)reject(error);else resolve(result);
    };
    const req = client.request(url, {
      method: "GET", lookup: guardedLookup,
      headers: { "User-Agent": userAgent, Accept: accept, "Accept-Language": "en-IN,en;q=0.9", "Accept-Encoding": "gzip, deflate, br" },
    }, res => {
      response=res;
      const status=res.statusCode||0;
      if(status>=300&&status<400&&res.headers.location)return finish(null,{redirect:res.headers.location});
      if(status===404||status===410)return finish(new LinkError("not_found"));
      if(status<200||status>=300)return finish(new LinkError("site_refused"));
      if(Number(res.headers["content-length"])>maxBytes)return finish(new LinkError("too_large"));
      res.on("error",()=>finish(new LinkError("network")));
      const encoding=String(res.headers["content-encoding"]||"").toLowerCase();
      stream=encoding==="gzip"?res.pipe(zlib.createGunzip()):encoding==="deflate"?res.pipe(zlib.createInflate()):encoding==="br"?res.pipe(zlib.createBrotliDecompress()):res;
      const chunks=[];let size=0;
      stream.on("data",chunk=>{size+=chunk.length;if(size>maxBytes)return finish(new LinkError("too_large"));chunks.push(chunk);});
      stream.on("end",()=>finish(null,{body:Buffer.concat(chunks),type:String(res.headers["content-type"]||"").toLowerCase()}));
      stream.on("error",()=>finish(new LinkError("network")));
    });
    // Absolute deadline covers DNS and slow-drip bodies, not just idle sockets.
    timer=setTimeout(()=>finish(new LinkError("timeout")),remaining);
    req.on("error",error=>finish(error instanceof LinkError?error:new LinkError(error.code==="EBLOCKED"?"blocked_address":"network")));
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
