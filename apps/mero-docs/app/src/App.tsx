// Root of the app: the session (local nodes in development, the Calimero
// Cloud cluster in production), then the UI providers, then the router. Auth
// is guarded by the workspace page; useDriveWorkspace owns cache invalidation.
//
// Routes:
//   /, /docs, /preview → landing page (public); "Sign in" opens SignInDialog
//   /app/*             → WorkspacePage (auth-guarded shell, mounts
//                        WorkspaceLayout; screen URLs in lib/routes)
//   *                  → redirect to /
//
// Above the routes: InvitationPrompt, which offers an invitation link that
// was opened, once the person is signed in.

import React, { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { CalimeroProvider, useMero } from '@/calimero/react';
import { SessionProvider, type SessionDeps } from '@/calimero/session';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { DriveWorkspaceProvider } from '@/hooks/useDriveWorkspace';
import { ThemeProvider, useTheme } from '@/components/theme/ThemeProvider';
import { appPath, readReturnTo } from '@/lib/routes';
import { nodeBasename } from '@/lib/servedByNode';

import { InvitationPage } from '@/components/workspace/InvitationPage';
import { InvitationPrompt } from '@/components/workspace/InvitationPrompt';
import { SignInDialog } from '@/components/workspace/SignInDialog';
import { deferInvite, inviteDeferred, pendingInvite } from '@/hooks/useNamespaceInvitation';

import LandingPage from './pages/landing/LandingPage';
import WorkspacePage from './pages/workspace';

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ['/', '/docs', '/preview'];
// Clears EditorStatusBar's bottom bar so a toast never covers "Saved • E2E Encrypted".
const TOAST_BOTTOM_OFFSET = 64;

/**
 * An authenticated visitor has no business on the marketing page.
 *
 * Signing in on the landing page lands here, and this carries the visitor
 * into the app (or on to the link they opened, see WorkspacePage).
 */
function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, nodeUrl } = useMero();
  if (isLoading) return null; // the auth probe is still in flight
  if (isAuthenticated)
    return <Navigate to={readReturnTo(nodeUrl ?? null) ?? '/app'} replace />;
  return <>{children}</>;
}

/**
 * The landing page, or, signed out with an invitation waiting, the invitation
 * as the whole page: no hero behind it, no popup, no extra click. "Not now"
 * comes back to the ordinary page, keeping the token for a later sign-in.
 */
function FrontDoor({ onConnect }: { onConnect: () => void }) {
  const { isAuthenticated, isLoading } = useMero();
  const [deferred, setDeferred] = useState(() => inviteDeferred());
  const invite = !isAuthenticated && !isLoading && !deferred ? pendingInvite() : null;
  if (invite) {
    return (
      <InvitationPage
        invite={invite}
        onNotNow={() => {
          deferInvite();
          setDeferred(true);
        }}
      />
    );
  }
  return <LandingPage onConnect={onConnect} />;
}

/** `*` → `/`, keeping the query (e.g. `?node=` on a dev window). */
function CatchAllRedirect() {
  const location = useLocation();
  const search = location.search;
  return <Navigate to={search ? `/${search}` : '/'} replace />;
}

// `!` is needed: sonner's own colour rules outrank plain utility classes. Only
// an error is red; a confirmation like "Link copied" keeps the card colours.
function AppToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      offset={{ bottom: TOAST_BOTTOM_OFFSET }}
      mobileOffset={{ bottom: TOAST_BOTTOM_OFFSET }}
      toastOptions={{
        classNames: {
          toast: '!bg-card !text-card-foreground !border-border',
          description: '!text-muted-foreground',
          error:
            '[&_[data-title]]:!text-destructive [&_[data-icon]]:!text-destructive',
        },
      }}
    />
  );
}

/**
 * The routes, under the app-level invitation prompt.
 *
 * `joins` keys the workspace: a join accepted while the workspace is already
 * open (a desktop deep link arriving on /app) must show the new workspace, and
 * navigating to the route the person is already on does not remount it. A
 * fresh mount reads the namespace list again and lands on the just-joined
 * workspace, exactly as arriving from a separate /join page used to.
 */
function AppRoutes() {
  const navigate = useNavigate();
  const location = useLocation();
  const here = useRef(location);
  here.current = location;
  const [joins, setJoins] = useState(0);
  const onJoined = useCallback(
    (workspace: string | null, folder: string | null) => {
      setJoins((n) => n + 1);
      // A link that opened a page inside the joined workspace (a document, a
      // folder) stays on it: the remount above reads it again as a member.
      const { pathname, search, hash } = here.current;
      const root = workspace ? appPath({ ws: workspace }) : null;
      if (root && (pathname === root || pathname.startsWith(`${root}/`))) {
        navigate(`${pathname}${search}${hash}`, { replace: true });
        return;
      }
      navigate(workspace ? appPath(folder ? { ws: workspace, folder } : { ws: workspace }) : '/app', {
        replace: true,
      });
    },
    [navigate],
  );
  const [signInOpen, setSignInOpen] = useState(false);
  const closeSignIn = useCallback(() => setSignInOpen(false), []);
  const openSignIn = useCallback(() => setSignInOpen(true), []);

  return (
    <>
      <InvitationPrompt onJoined={onJoined} />
      <SignInDialog open={signInOpen} onClose={closeSignIn} />
      <Routes>
        {/* The landing page is three pages: `/`, `/docs` and `/preview`. They are
              real URLs so they can be shared and opened cold, which needs a route
              here - otherwise this app's catch-all swallows the deep link before
              the page ever renders. */}
        {LANDING_PATHS.map((landingPath) => (
          <Route
            key={landingPath}
            path={landingPath}
            // Only `/` bounces a signed-in visitor into the app; `/docs` and
            // `/preview` are reference pages someone signed in may still want.
            element={
              landingPath === '/' ? (
                <RedirectIfAuthed>
                  <FrontDoor onConnect={openSignIn} />
                </RedirectIfAuthed>
              ) : (
                <FrontDoor onConnect={openSignIn} />
              )
            }
          />
        ))}
        {/* The /login PAGE is gone - every app had one, every one looked
              different, and its whole content was a button the visitor had
              already pressed to get there. The path stays as a redirect so a
              bookmark lands on the front door instead of a blank route. */}
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route
          path="/app/*"
          element={
            <DriveWorkspaceProvider key={joins}>
              {/* Inside the workspace: a confirmation's body may name members. */}
              <ConfirmProvider>
                <WorkspacePage />
              </ConfirmProvider>
            </DriveWorkspaceProvider>
          }
        />
        {/* `/join` included: an invitation link that landed there was
              taken by the capture at boot, and InvitationPrompt offers it
              whatever page this sends the visitor to. */}
        <Route path="*" element={<CatchAllRedirect />} />
      </Routes>
    </>
  );
}

export default function App({ deps }: { deps?: SessionDeps } = {}) {
  return (
    <ThemeProvider>
      <SessionProvider deps={deps}>
        <CalimeroProvider>
          <AppToaster />
          <TooltipProvider>
            <BrowserRouter
              basename={nodeBasename()}
              future={{
                v7_startTransition: true,
                v7_relativeSplatPath: true,
              }}
            >
              <AppRoutes />
            </BrowserRouter>
          </TooltipProvider>
        </CalimeroProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
