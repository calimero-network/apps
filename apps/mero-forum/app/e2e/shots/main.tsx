// Screenshot harness entry. Renders the real pages against fixture modules.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import FeedPage from "../../src/pages/FeedPage";
import PostPage from "../../src/pages/PostPage";
import SpacesPage from "../../src/pages/SpacesPage";
import ForumsPage from "../../src/pages/ForumsPage";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { scenarioById } from "./fixtures";
import "../../src/index.css";

const sc = scenarioById(
  new URLSearchParams(location.search).get("s") ?? "feed",
);
// Light is the default, so only a dark scenario sets the attribute.
if (sc.theme) document.documentElement.dataset.theme = sc.theme;

const initial =
  sc.page === "post"
    ? "/p/p1"
    : sc.page === "forums"
      ? "/spaces/ns-1"
      : sc.page === "spaces"
        ? "/spaces"
        : "/f";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <MemoryRouter initialEntries={[initial]}>
        {/* ⚠️ `.shell` (a 720px column) wraps ONLY the feed and thread routes in
            App.tsx — the pickers own their full-width layout. The harness used
            to wrap everything, which squeezed the space and forum pages into a
            narrow off-centre column and photographed a layout the app never
            renders. A harness that does not mirror its app documents fiction. */}
        <Routes>
          <Route path="/spaces" element={<SpacesPage />} />
          <Route path="/spaces/:namespaceId" element={<ForumsPage />} />
          <Route
            path="/f"
            element={
              <div className="shell">
                <FeedPage />
              </div>
            }
          />
          <Route
            path="/p/:postId"
            element={
              <div className="shell">
                <PostPage />
              </div>
            }
          />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  </StrictMode>,
);
