import Usage from './Usage';
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import InviteAcceptance from "./InviteAcceptance";
import Billing from "./Billing";
import "./styles.css";
import { isNative } from "./native";

document.documentElement.classList.toggle("native-app", isNative);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.pathname === "/invite" ? <InviteAcceptance /> : window.location.pathname === "/billing" ? <Billing /> : window.location.pathname === "/usage" ? <Usage /> : <App />}
  </React.StrictMode>,
);
