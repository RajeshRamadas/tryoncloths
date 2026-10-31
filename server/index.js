import { createApp } from "./app.js";
import { providerConfig } from "./provider-config.js";
import { AccountStore } from "./accounts.js";
const port = Number(process.env.PORT || 3001);
const production = process.argv.includes("--production");
const trustProxySetting = process.env.TRYON_TRUST_PROXY_HOPS || "0";
if (!["0", "1"].includes(trustProxySetting)) throw new Error("TRYON_TRUST_PROXY_HOPS must be 0 or 1.");
const accountStore = process.env.TRYON_DATA_DIR ? new AccountStore(process.env.TRYON_DATA_DIR) : null;
if (accountStore) {
  accountStore.billing.sweep();
  setInterval(()=>{try {accountStore.billing.sweep();} catch {console.error(JSON.stringify({event:"credit_sweep_failed"}));}},5*60*1000).unref();
}
const app=createApp({ production, accountStore, allowSignup: process.env.TRYON_ALLOW_SIGNUP !== "false", trustProxy: trustProxySetting === "1" ? 1 : false });
if(app.locals.payments){
  const retry=()=>app.locals.payments.retryInvoices().catch(()=>console.error(JSON.stringify({event:"invoice_retry_failed"})));
  void retry();setInterval(()=>void retry(),5*60*1000).unref();
}
app.listen(port, "0.0.0.0", (error) => {
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
