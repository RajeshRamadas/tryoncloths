import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.rajeshramadas.tryoncloths",
  appName: "Forme Studio",
  webDir: "dist",
  loggingBehavior: "none",
  server: { androidScheme: "https", errorPath: "webview-update.html" },
  android: {
    backgroundColor: "#f8f9f6",
    allowMixedContent: false,
    minWebViewVersion: 108,
  },
};

export default config;
