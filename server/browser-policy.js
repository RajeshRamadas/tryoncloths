import { parseProductUrl } from './public-url.js';

// Network-layer rules in the isolated worker still enforce resolved addresses.
export function allowBrowserRequest(raw, type, pageOrigin) {
  try {
    const url = parseProductUrl(raw);
    if (!['document','script','stylesheet','xhr','fetch'].includes(type)) return false;
    // Keep page scripts, but not unrelated ad/analytics scripts.
    if (type === 'script' && url.origin !== pageOrigin) return false;
    return true;
  } catch { return false; }
}
