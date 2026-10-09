import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AppMode, MeroProvider } from "@calimero-network/mero-react";
import { App } from "./App";
import { adoptDesktopSession } from "./utils/desktopSso";
import { PACKAGE_NAME, REGISTRY_URL } from "./config";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

// Before React mounts: the provider resolves the auth callback on its first
// render, so a desktop hand-off's node has to be in storage by then. See
// utils/desktopSso.ts.
adoptDesktopSession();

// StrictMode in dev only; double-invoked effects mislead when reading a call log.
const Wrapper = import.meta.env.DEV
  ? StrictMode
  : ({ children }: { children: ReactNode }) => <>{children}</>;

createRoot(root).render(
  <Wrapper>
    {/*
      MultiContext: the auth callback returns tokens and an application id, and
      the app picks the context (FeedPicker). `packageName` + `registryUrl` let
      the auth frontend resolve this app's allowed callback origin.
    */}
    <MeroProvider mode={AppMode.MultiContext} packageName={PACKAGE_NAME} registryUrl={REGISTRY_URL}>
      <App />
    </MeroProvider>
  </Wrapper>,
);
