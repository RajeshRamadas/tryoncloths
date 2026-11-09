import https from "node:https";
import { parseProductUrl, guardedLookup } from "./public-url.js";

// Authenticated requests never follow redirects or attach credentials to image
// requests. DNS is checked at connection time, including rebinding attempts.
export function integrationFetch(
  raw,
  {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 20000,
    maxBytes = 4 * 1024 * 1024,
    requestImpl = https.request,
  } = {},
) {
  const url = parseProductUrl(String(raw));
  if (url.protocol !== "https:") throw new Error("HTTPS required");
  return new Promise((resolve, reject) => {
    let res,
      timer,
      done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) {
        res?.destroy();
        req.destroy();
        reject(new Error("Shop API request failed"));
      } else resolve(value);
    };
    const req = requestImpl(
      url,
      {
        method,
        lookup: guardedLookup,
        headers: { Accept: "application/json", "Accept-Encoding": "identity", ...headers },
      },
      (response) => {
        res = response;
        if (Number(res.headers["content-length"]) > maxBytes) return finish(true);
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) return finish(true);
          chunks.push(chunk);
        });
        res.on("end", () =>
          finish(null, {
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on("error", () => finish(true));
      },
    );
    timer = setTimeout(() => finish(true), timeoutMs);
    req.on("error", () => finish(true));
    req.end(body);
  });
}
