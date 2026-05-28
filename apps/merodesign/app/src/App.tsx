import { Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import TeamsPage from "./pages/TeamsPage";
import ProjectsPage from "./pages/ProjectsPage";
import CanvasPage from "./pages/CanvasPage";
import CursorDot from "./components/CursorDot";

export default function App() {
  return (
    <>
      <CursorDot />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/teams/:teamId/projects" element={<ProjectsPage />} />
        <Route path="/teams/:teamId/projects/:projectId" element={<CanvasPage />} />
      </Routes>
    </>
  );
}
