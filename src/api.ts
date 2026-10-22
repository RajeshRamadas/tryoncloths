import { Capacitor } from "@capacitor/core";
import { normalizeStudioUrl } from "./connection";

// Connection credentials intentionally stay in memory and are never bundled or persisted.
let studioUrl = "";
let studioToken = "";

export function studioConnection() {
  return { url: studioUrl, connected: Boolean(studioUrl && studioToken) };
}
export function setStudioConnection(url: string, token: string) {
  const normalized = normalizeStudioUrl(url);
  if (token.trim().length < 24)
    throw new Error(
      "Enter the store access code supplied by your administrator (at least 24 characters).",
    );
  studioUrl = normalized;
  studioToken = token.trim();
}
export function disconnectStudio() {
  studioUrl = "";
  studioToken = "";
}

export async function requestApi(
  path: string,
  init: RequestInit = {},
  timeoutMs = 10000,
) {
  if (!path.startsWith("/api/")) throw new Error("Invalid studio request.");
  if (Capacitor.isNativePlatform() && !studioUrl)
    throw new Error(
      "Connect a studio to generate a customer avatar with matching skin tone. Sample browsing works offline.",
    );
  const headers = new Headers(init.headers);
  if (studioToken) headers.set("Authorization", `Bearer ${studioToken}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${studioUrl}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
      credentials: "omit",
    });
  } finally {
    clearTimeout(timer);
  }
}
