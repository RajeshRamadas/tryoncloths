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
