// Screenshot harness entry. Renders the real pages against fixture hooks.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CallPage from "../../src/pages/CallPage";
import StreamsPage from "../../src/pages/StreamsPage";
import RoomsPage from "../../src/pages/RoomsPage";
import OpenDialog from "./OpenDialog";
import { scenarioById } from "./fixtures";
import { setUsername } from "../../src/lib/session";
import "../../src/index.css";

const sc = scenarioById(new URLSearchParams(location.search).get("s") ?? "idle");
if (sc.theme) document.documentElement.dataset.theme = sc.theme;

// CallPage nudges the identity dialog open ONCE for anyone who has never picked
// a name, and the harness starts from an empty localStorage every time — so
// without this every call scenario photographed the nudge sitting over the call
// instead of the call. Seed a name for the scenarios that are about something
// else, and leave it unset for `first-run`, which is about the nudge.
if (sc.id !== "first-run") setUsername("Ana");

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
