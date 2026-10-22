import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const webPort = process.env.TEST_WEB_PORT || "5174";
const apiPort = process.env.TEST_API_PORT || "3101";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    headless: true,
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    },
  },
  webServer: {
    command: "npm run dev",
    url: `http://127.0.0.1:${webPort}`,
    env: { PORT: apiPort, VITE_PORT: webPort },
    reuseExistingServer: false,
    timeout: 30000,
  },
});
