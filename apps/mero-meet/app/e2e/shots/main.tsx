// Screenshot harness entry. Renders the real pages against fixture hooks.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TeamsPage from "../../src/pages/TeamsPage";
import RoomsPage from "../../src/pages/RoomsPage";
import { ToastProvider } from "../../src/contexts/ToastContext";
import OpenDialog from "./OpenDialog";
import { scenarioById } from "./fixtures";
import "../../src/index.css";

const sc = scenarioById(
  new URLSearchParams(location.search).get("s") ?? "teams",
);
// Light is the default, so only a dark scenario sets the attribute.
if (sc.theme) document.documentElement.dataset.theme = sc.theme;

// A real router, because the pages use `useNavigate` and `useParams`.
// MemoryRouter rather than BrowserRouter so the harness URL (?s=…) stays the
// scenario switch and is not also the app's route.
const initial = sc.page === "rooms" ? "/teams/ns-1" : "/teams";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:namespaceId" element={<RoomsPage />} />
        </Routes>
      </MemoryRouter>
      {sc.invite ? <OpenDialog testId="invite-btn" /> : null}
    </ToastProvider>
  </StrictMode>,
);
