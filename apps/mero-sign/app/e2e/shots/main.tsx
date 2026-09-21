// Screenshot harness entry. Renders the REAL pages against fixture modules, so
// what is photographed is the shipping UI rather than a re-implementation.
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AgreementsPage from '../../src/pages/app/AgreementsPage';
import WorkspacesPage from '../../src/pages/app/WorkspacesPage';
import AgreementPage from '../../src/pages/app/AgreementPage';
import SignaturesPage from '../../src/pages/app/SignaturesPage';
import ConnectGate from '../../src/components/ConnectGate';
import NotFound from '../../src/components/NotFound';
import LandingPage from '../../src/pages/landing/LandingPage';
import { ThemeProvider } from '../../src/contexts/ThemeContext';
import { ALICE, current } from './fixtures';

// The agreement screens read the open agreement and the executor key out of
// storage — the route param is the source of truth for WHICH agreement, but the
// executor key has no other home. Seeded here, or `mintLink` early-returns and
// the invite scenario photographs an error instead of a link.
try {
  localStorage.setItem('agreementContextID', 'ctx-1');
  localStorage.setItem('agreementContextUserID', ALICE);
} catch {
  /* a blocked localStorage just means those scenarios show their empty state */
}
import '../../src/index.css';

/**
 * Force the states a click would otherwise reach.
 *
 * The alternative — photographing a fixed sleep after mount — is how a harness
 * comes to document a screen the app never renders. Driving the real controls
 * means the modal in the picture is the modal the app opens.
 */
function Driver() {
  useEffect(() => {
    let stop = false;
    /**
     * Poll for the control, then click it.
     *
     * A fixed timer was not enough: the signature list resolves a blob and a
     * FileReader before it renders a card, so the delete scenario kept firing
     * at 120ms against a page still saying "Loading…" and photographing that.
     * Waiting for the element is the same rule the driver uses for its own
     * screenshots — never a sleep, always the thing you are waiting for.
     */
    function clickWhenPresent(
      find: () => HTMLElement | null | undefined,
      then?: () => void,
      tries = 60,
    ) {
      if (stop) return;
      const el = find();
      if (el) {
        el.click();
        if (then) setTimeout(then, 60);
        return;
      }
      if (tries > 0)
        setTimeout(() => clickWhenPresent(find, then, tries - 1), 50);
    }

    const byTestId = (id: string) => () =>
      document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

    if (current.tab) {
      clickWhenPresent(byTestId(`tab-${current.tab}`), () => {
        // A tab switch is a re-render, so anything inside the new tab only
        // exists on a later tick.
        if (current.open === 'upload')
          clickWhenPresent(byTestId('open-upload'));
        if (current.open === 'invite')
          clickWhenPresent(byTestId('mint-invite'));
      });
    } else if (current.open === 'delete-signature') {
      clickWhenPresent(
        () => {
          const card = document.querySelector('[data-testid="signature-card"]');
          return [
            ...(card?.querySelectorAll<HTMLElement>('button') ?? []),
          ].find((b) => b.textContent?.trim() === '⋯');
        },
        () =>
          clickWhenPresent(() =>
            [...document.querySelectorAll<HTMLElement>('button')].find(
              (b) => b.textContent?.trim() === 'Delete',
            ),
          ),
      );
    }

    return () => {
      stop = true;
    };
  }, []);
  return null;
}

createRoot(document.getElementById('root')!).render(
  // NOT StrictMode. The app enables it in dev only, and its double-invoked
  // effects re-enter the loading state after the first paint — which is how the
  // signatures screen got photographed saying "Loading…" while the harness
  // reported the card as found.
  <ThemeProvider>
    <MemoryRouter initialEntries={[current.path]}>
      <Driver />
      <Routes>
        <Route path="/landing" element={<LandingPage />} />
        <Route
          path="/workspaces"
          element={
            current.authed ? (
              <WorkspacesPage />
            ) : (
              <ConnectGate what="Your workspaces" />
            )
          }
        />
        {/* The agreements screen is scoped to a workspace: an agreement is a
            subgroup of one. `/agreements` still renders it — with nothing
            selected it shows the "choose a workspace" state, which is what
            the `connect` scenario photographs behind the gate. */}
        <Route
          path="/workspaces/:workspaceId"
          element={
            current.authed ? (
              <AgreementsPage />
            ) : (
              <ConnectGate what="This agreement" />
            )
          }
        />
        <Route
          path="/agreements"
          element={
            current.authed ? (
              <AgreementsPage />
            ) : (
              <ConnectGate what="This agreement" />
            )
          }
        />
        <Route path="/agreements/:agreementId" element={<AgreementPage />} />
        <Route path="/signatures" element={<SignaturesPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </MemoryRouter>
  </ThemeProvider>,
);
