import { createApp } from "./app.js";
const port = Number(process.env.PORT || 3001);
const production = process.argv.includes("--production");
createApp({ production }).listen(port, "0.0.0.0", (error) => {
  if (error) {
    console.error(
      `Could not start Forme on port ${port}: ${error.code || error.message}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Forme ${production ? "app" : "API"} listening on port ${port}. Face personalization: ${process.env.TRYON_GEMINI_API_KEY ? "configured" : "not configured"}.`,
  );
});
