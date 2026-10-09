/**
 * The connect dialog for the landing page's CTA: a **Node** tab and a **Cloud**
 * tab, the same two ways in that `<ConnectButton/>` offers inside the app.
 *
 * GENERATED FILE. Source: scripts/landing/template/loginPopup.tsx.
 * `pnpm landing:generate` writes it into every app that depends on
 * `@calimero-network/mero-react`; `pnpm landing:check` fails CI on drift.
 *
 * ⚠️ This replaces a `/login` PAGE in ten of the fourteen apps, and the reason
 * is worth keeping. Each of those pages rendered the app's name, its
 * description and a connect button, in that app's own styling — so pressing
 * "Connect to node" on a carefully built landing page took you to a second,
 * unrelated-looking page to press a second button. The page was never a step;
 * it was a detour.
 *
 * `LoginModal` already does the part that mattered: it discovers local nodes
 * and takes a URL by hand. `connectToNode` does the rest — the node signs the
 * visitor in and the app's own route guard sends them where they were going.
 *
 * ⚠️ WHY THE CLOUD TAB IS HERE AND NOT LEFT TO `LoginModal`'S DEFAULT.
 * `LoginModal` has no tabs unless it is handed `cloud`; `<ConnectButton/>`
 * builds that prop from `useAccountEnrolment()` and so shows both tabs, but
 * this popup used to mount the modal bare. The result was that every app whose
 * front door is this landing page had NO account sign-in reachable from it —
 * the one place a first-time visitor actually starts — and a delegated
 * (Calimero account) demo could not begin from the front page. The popup now
 * does exactly what `ConnectButton` does: one enrolment hook, its values
 * passed through, and the modal renders the tab.
 *
 * Enrolment is a redirect: `goToWallet` leaves for the wallet, and the wallet
 * sends the tab back to this page with a callback in the URL. The hook reads
 * it during render and reports `returning`. The landing page owns `isOpen`
 * and knows nothing about enrolment, so the popup opens ITSELF for that one
 * page load — otherwise the person comes back from the wallet to a closed
 * dialog and never sees the note the hook has for them (an error, or a
 * connection with nowhere to write yet). Closing it clears that, so a later
 * click behaves as a fresh open.
 */
import { useState } from 'react';
import { LoginModal, useAccountEnrolment, useMero } from '@calimero-network/mero-react';

import type { LoginPopupProps } from './landingTypes';

export default function LoginPopup({ isOpen, onClose }: LoginPopupProps) {
  const { connectToNode } = useMero();
  const enrolment = useAccountEnrolment();
  // Open on the page load that carries the wallet's callback; see the header.
  const [openedOnReturn, setOpenedOnReturn] = useState(() => enrolment.returning);

  const close = () => {
    setOpenedOnReturn(false);
    onClose();
  };

  return (
    <LoginModal
      isOpen={isOpen || openedOnReturn}
      onClose={close}
      onConnect={(url) => {
        // Closed first: `connectToNode` navigates away to the node's sign-in,
        // and a modal still mounted over a page that is leaving flashes.
        close();
        connectToNode(url);
      }}
      cloud={{
        onEnrol: () => {
          void enrolment.goToWallet();
        },
        note: enrolment.note,
        walletUrl: enrolment.walletUrl,
        customWallet: enrolment.customWallet,
      }}
      initialTab={enrolment.returning ? 'cloud' : 'node'}
    />
  );
}
