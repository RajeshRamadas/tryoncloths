import { createApp } from "./app.js";
import { providerConfig } from "./provider-config.js";
const port = Number(process.env.PORT || 3001);
const production = process.argv.includes("--production");
const trustProxySetting = process.env.TRYON_TRUST_PROXY_HOPS || "0";
if (!["0", "1"].includes(trustProxySetting)) throw new Error("TRYON_TRUST_PROXY_HOPS must be 0 or 1.");
createApp({ production, trustProxy: trustProxySetting === "1" ? 1 : false }).listen(port, "0.0.0.0", (error) => {
  if (error) {
    console.error(
      `Could not start Forme on port ${port}: ${error.code || error.message}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Forme ${production ? "app" : "API"} listening on port ${port}. Customer avatar generation: ${providerConfig().apiKey ? "configured" : "not configured"} (${providerConfig().label}).`,
  );
});
