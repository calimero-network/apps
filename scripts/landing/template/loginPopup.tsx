/**
 * The connect dialog for the landing page's CTA: sign in with a passkey on the
 * app's Calimero Cloud cluster, or create an account with one.
 *
 * GENERATED FILE. Source: scripts/landing/template/loginPopup.tsx.
 * `pnpm landing:generate` writes it into every app that depends on
 * `@calimero-apps/cloud`; `pnpm landing:check` fails CI on drift.
 *
 * ⚠️ This replaces a `/login` PAGE in ten of the fourteen apps, and the reason
 * is worth keeping. Each of those pages rendered the app's name, its
 * description and a connect button, in that app's own styling — so pressing
 * "Connect" on a carefully built landing page took you to a second,
 * unrelated-looking page to press a second button. The page was never a step;
 * it was a detour.
 *
 * `LoginModal` runs the passkey ceremony itself, in the page, and hands back
 * the cluster it signed in on; `connectToNode` adopts that session and the
 * app's own route guard sends the person where they were going. (v1 offered a
 * Node tab and a wallet-enrolment Cloud tab here; on Calimero Cloud a person
 * is their passkey account, so there is one way in.)
 */
import { LoginModal, useMero } from '@calimero-apps/cloud';

import type { LoginPopupProps } from './landingTypes';

export default function LoginPopup({ isOpen, onClose }: LoginPopupProps) {
  const { connectToNode } = useMero();
  return (
    <LoginModal
      isOpen={isOpen}
      onClose={onClose}
      onConnect={(url) => {
        onClose();
        connectToNode(url);
      }}
    />
  );
}
