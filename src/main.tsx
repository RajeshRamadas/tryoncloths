import Branding from "./branding";
import AvatarViews from "./AvatarViews";
import JewelleryCatalogue from "./JewelleryCatalogue";
import ShopperSettings from "./ShopperSettings";
import ShopifyShopper from "./ShopifyShopper";
import CataloguePhotos from "./CataloguePhotos";
import Analytics from "./Analytics";
import SizeCharts from "./SizeCharts";
import CatalogueManager from "./CatalogueManager";
import WhatsApp from "./WhatsApp";
import Usage from "./Usage";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import InviteAcceptance from "./InviteAcceptance";
import Billing from "./Billing";
import "./styles.css";
import { isNative } from "./native";

const CompleteLook = React.lazy(() => import("./CompleteLook"));
const JewelleryStudio = React.lazy(() => import("./JewelleryStudio"));

document.documentElement.classList.toggle("native-app", isNative);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.pathname === "/complete-look" ? (
      <React.Suspense fallback={<p role="status">Opening complete looks…</p>}>
        <CompleteLook />
      </React.Suspense>
    ) : window.location.pathname === "/jewellery" ? (
      <React.Suspense fallback={<p role="status">Opening jewellery studio…</p>}>
        <JewelleryStudio />
      </React.Suspense>
    ) : window.location.pathname === "/avatar-views" ? (
      <AvatarViews />
    ) : window.location.pathname === "/jewellery-catalogue" ? (
      <JewelleryCatalogue />
    ) : window.location.pathname === "/shopify-shopper" ? (
      <ShopifyShopper />
    ) : window.location.pathname === "/shopper-spending" ? (
      <ShopperSettings />
    ) : window.location.pathname === "/branding" ? (
      <Branding />
    ) : window.location.pathname === "/catalogue-photos" ? (
      <CataloguePhotos />
    ) : window.location.pathname === "/analytics" ? (
      <Analytics />
    ) : window.location.pathname === "/size-charts" ? (
      <SizeCharts />
    ) : window.location.pathname === "/catalogue" ? (
      <CatalogueManager />
    ) : window.location.pathname === "/whatsapp" ? (
      <WhatsApp />
    ) : window.location.pathname === "/invite" ? (
      <InviteAcceptance />
    ) : window.location.pathname === "/billing" ? (
      <Billing />
    ) : window.location.pathname === "/usage" ? (
      <Usage />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
