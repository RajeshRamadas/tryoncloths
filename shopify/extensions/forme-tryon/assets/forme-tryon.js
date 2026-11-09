// Public product id + random per-click nonce only. No photos, tracking ids,
// customer records, app secrets, Forme cookies or AI calls in the storefront.
(() => {
  const selector = "a[data-forme-tryon]";
  function stamp(link) {
    if (!globalThis.crypto?.getRandomValues) return;
    const url = new URL(link.getAttribute("href"), location.origin);
    if (url.origin !== location.origin || url.pathname !== "/apps/forme-tryon") return;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    url.searchParams.set(
      "launch_nonce",
      Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
    );
    link.setAttribute("href", url.pathname + url.search);
  }
  function initialize() {
    document.querySelectorAll(selector).forEach(stamp);
  }
  document.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest?.(selector);
      if (link) stamp(link);
    },
    true,
  );
  document.addEventListener("shopify:section:load", initialize);
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
