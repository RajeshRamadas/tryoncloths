import dns from "node:dns";
import net from "node:net";
import { LinkError } from "./link-errors.js";

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

export function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address)))
      return callback(Object.assign(new Error("Blocked address"), { code: "EBLOCKED" }));
    if (options?.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}
