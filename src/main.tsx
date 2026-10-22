import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { isNative } from "./native";

document.documentElement.classList.toggle("native-app", isNative);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
