/** Validate a remote studio address without accepting embedded credentials. */
export function normalizeStudioUrl(value) {
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "Enter the HTTPS address of your studio, without a path or sign-in details.",
    );
  }
  return url.origin;
}
