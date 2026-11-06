import Branding from "./branding";
import CataloguePhotos from "./CataloguePhotos";
import Analytics from "./Analytics";
import SizeCharts from "./SizeCharts";
import CatalogueManager from "./CatalogueManager";
import WhatsApp from "./WhatsApp";
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
    {window.location.pathname === "/branding" ? <Branding /> : window.location.pathname === "/catalogue-photos" ? <CataloguePhotos /> : window.location.pathname === "/analytics" ? <Analytics /> : window.location.pathname === "/size-charts" ? <SizeCharts /> : window.location.pathname === "/catalogue" ? <CatalogueManager /> : window.location.pathname === "/whatsapp" ? <WhatsApp /> : window.location.pathname === "/invite" ? <InviteAcceptance /> : window.location.pathname === "/billing" ? <Billing /> : window.location.pathname === "/usage" ? <Usage /> : <App />}
  </React.StrictMode>,
);
