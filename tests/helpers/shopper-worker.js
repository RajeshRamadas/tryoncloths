import { parentPort, workerData } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { AccountStore } from "./pilot-accounts.js";
const store = new AccountStore(workerData.directory);
parentPort.postMessage("ready");
parentPort.once("message", () => {
  try {
    store.shoppers.reserve({
      store: workerData.store,
      requestId: randomUUID(),
      action: "avatar",
      bodyHash: "ab".repeat(32),
      sessionHash: "cd".repeat(32),
    });
    parentPort.postMessage({ ok: true });
  } catch (error) {
    parentPort.postMessage({ ok: false, code: error.code, message: error.message });
  } finally {
    store.close();
  }
});
