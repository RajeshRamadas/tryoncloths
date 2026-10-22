import { readFile } from "node:fs/promises";
import { customerPhotos } from "./customer-photos.js";

// Exercise the Android UI/bridge contract without pretending these are device tests.
export async function nativeBridge(page, photos) {
  if (!photos) {
    photos = await Promise.all([customerPhotos[0].face, customerPhotos[0].body].map(async path =>
      `data:image/jpeg;base64,${(await readFile(path)).toString("base64")}`,
    ));
  }
  await page.addInitScript(
    ({ photos }) => {
      let nextPhoto = 0;
      window.CapacitorCustomPlatform = { name: "android" };
      window.__nativeCalls = [];
      window.__nativeErrors = {};
      window.__nativeListeners = {};
      window.Capacitor = {
        PluginHeaders: [
          { name: "Camera", methods: [{ name: "getPhoto", rtype: "promise" }] },
          {
            name: "Filesystem",
            methods: ["rmdir", "writeFile"].map((name) => ({
              name,
              rtype: "promise",
            })),
          },
          { name: "Share", methods: [{ name: "share", rtype: "promise" }] },
          {
            name: "App",
            methods: [
              { name: "addListener", rtype: "callback" },
              { name: "removeListener", rtype: "promise" },
              { name: "minimizeApp", rtype: "promise" },
            ],
          },
        ],
        nativePromise: async (plugin, method, options) => {
          window.__nativeCalls.push({ plugin, method, options });
          if (window.__nativeErrors[plugin])
            throw new Error(window.__nativeErrors[plugin]);
          if (plugin === "Camera") return { dataUrl: photos[nextPhoto++ % photos.length] };
          if (method === "writeFile")
            return { uri: "file:///cache/forme-exports/approved-avatar.png" };
          if (method === "removeListener")
            delete window.__nativeListeners[options.callbackId];
          return {};
        },
        nativeCallback: (plugin, method, options, callback) => {
          const id = `listener-${Math.random()}`;
          window.__nativeListeners[id] = callback;
          return id;
        },
      };
    },
    { photos },
  );
  await page.setViewportSize({ width: 412, height: 915 });
}
