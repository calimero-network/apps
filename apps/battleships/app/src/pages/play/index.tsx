import { Navigate, useLocation } from 'react-router-dom';

/**
 * Legacy play page — redirects to the unified match flow.
 *
 * All gameplay lives in MatchPage (/match). An old `?match_id=` link keeps
 * its match id; v1's `context_id` is dropped (a match is in its lobby's app
 * instance now).
 */
export default function PlayPage() {
  const matchId = new URLSearchParams(useLocation().search).get('match_id');
  return (
    <Navigate to={matchId ? `/match?match_id=${encodeURIComponent(matchId)}` : '/lobby'} replace />
  );
}
