import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ['xlsx'] },
  build: { target: "chrome108" },
  server: {
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${process.env.PORT || 3001}`, "^/shopper(?:$|[/?])": `http://127.0.0.1:${process.env.PORT || 3001}`, "^/shopper-api/": `http://127.0.0.1:${process.env.PORT || 3001}`, "^/shopify/": `http://127.0.0.1:${process.env.PORT || 3001}`, "^/reports/": `http://127.0.0.1:${process.env.PORT || 3001}`, "^/w/": `http://127.0.0.1:${process.env.PORT || 3001}`, "^/s/": `http://127.0.0.1:${process.env.PORT || 3001}` },
  },
});
