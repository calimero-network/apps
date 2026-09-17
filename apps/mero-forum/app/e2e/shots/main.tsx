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
        {/* `.shell` is the width constraint App.tsx wraps the app routes in. */}
        <div className="shell">
          <Routes>
            <Route path="/spaces" element={<SpacesPage />} />
            <Route path="/spaces/:namespaceId" element={<ForumsPage />} />
            <Route path="/f" element={<FeedPage />} />
            <Route path="/p/:postId" element={<PostPage />} />
          </Routes>
        </div>
      </MemoryRouter>
    </ToastProvider>
  </StrictMode>,
);
