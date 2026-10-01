/**
 * The node-connection and sign-in popup, for the landing page's CTA.
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
 */
import { LoginModal, useMero } from '@calimero-network/mero-react';

import type { LoginPopupProps } from './landingTypes';

export default function LoginPopup({ isOpen, onClose }: LoginPopupProps) {
  const { connectToNode } = useMero();

  return (
    <LoginModal
      isOpen={isOpen}
      onClose={onClose}
      onConnect={(url) => {
        // Closed first: `connectToNode` navigates away to the node's sign-in,
        // and a modal still mounted over a page that is leaving flashes.
        onClose();
        connectToNode(url);
      }}
    />
  );
}
