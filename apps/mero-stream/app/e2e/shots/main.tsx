// Screenshot harness entry. Renders the real pages against fixture hooks.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CallPage from "../../src/pages/CallPage";
import StreamsPage from "../../src/pages/StreamsPage";
import RoomsPage from "../../src/pages/RoomsPage";
import OpenDialog from "./OpenDialog";
import { scenarioById } from "./fixtures";
import "../../src/index.css";

const sc = scenarioById(new URLSearchParams(location.search).get("s") ?? "idle");
if (sc.theme) document.documentElement.dataset.theme = sc.theme;

// A real router, because the pages use `useNavigate` and `useParams`. MemoryRouter
// rather than BrowserRouter so the harness URL (?s=...) stays the scenario switch
// and is not also the app's route.
const initial = sc.page === "rooms" ? "/streams/ns-1" : "/streams";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route
          path="/streams"
          element={sc.page === "streams" ? <StreamsPage /> : <CallPage />}
        />
        <Route path="/streams/:namespaceId" element={<RoomsPage />} />
      </Routes>
    </MemoryRouter>
    {sc.dialog ? (
      <OpenDialog
        testId={sc.dialog === "people" ? "people-toggle" : "details-toggle"}
      />
    ) : null}
    {sc.invite ? <OpenDialog testId="invite-btn" /> : null}
  </StrictMode>,
);
