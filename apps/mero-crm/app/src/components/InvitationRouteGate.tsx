import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';
import { usePendingInvitation } from '../hooks/usePendingInvitation';
import { APP_ROUTE } from '../config';

/**
 * Mounted at APP level, not on a page — because an invitation link can land on
 * any route.
 *
 * Redeeming needs a session and the workspace hook, both of which live under
 * `AppPage` at `APP_ROUTE`. A link opened anywhere else (`/docs`, `/preview`, a
 * bookmarked deep path, or the launcher appending `?invitation=…` to whatever
 * frontend URL it had) previously captured the invitation and then left it
 * sitting there, because the only component that reads it never mounted. The
 * visitor saw nothing at all and concluded the link was broken.
 *
 * So this walks them to the one route that can redeem. It does not join, does
 * not ack, and renders nothing: `AppPage` sees the same sticky capture the
 * moment it mounts and takes it from there.
 *
 * It deliberately waits for authentication. An unauthenticated visitor belongs
 * on the landing page to sign in first, and the capture is durable across that
 * redirect, so the invitation is still waiting when they come back.
 */
export default function InvitationRouteGate(): null {
  const invitation = usePendingInvitation();
  const { isAuthenticated, isLoading } = useMero();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!invitation || isLoading || !isAuthenticated) return;
    if (pathname === APP_ROUTE || pathname.startsWith(`${APP_ROUTE}/`)) return;
    navigate(APP_ROUTE, { replace: true });
  }, [invitation, isAuthenticated, isLoading, pathname, navigate]);

  return null;
}
