import { Route, Routes, Navigate } from "react-router-dom";

import FeedPage from "./pages/FeedPage";
import PostPage from "./pages/PostPage";

export default function App() {
  return (
    <div className="shell">
      <Routes>
        <Route path="/" element={<FeedPage />} />
        <Route path="/p/:postId" element={<PostPage />} />
        {/* Unknown routes fall back to the feed rather than a blank page — a
            shared link that has gone stale should still land somewhere. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
