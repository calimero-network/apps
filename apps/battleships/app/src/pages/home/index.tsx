import { Navigate } from 'react-router-dom';

/**
 * Legacy home page: old bookmarks and links to /home land in the lobby,
 * which signs in first when it has to.
 */
export default function HomePage() {
  return <Navigate to="/lobby" replace />;
}
