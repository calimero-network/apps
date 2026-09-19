import { useEffect, useRef } from 'react';
import { useCalimero } from '../../lib/useCalimero';
import type { LoginPopupProps } from './landingTypes';

/**
 * The node-connection step behind the landing page's "Connect to node".
 *
 * ⚠️ NOT the generated `loginPopup.tsx`. That one is written into every app that
 * depends on `@calimero-network/mero-react` and uses its `LoginModal` +
 * `connectToNode`; Mero Sign is the app still on
 * `@calimero-network/calimero-client`, so `landing:generate` skips it and this
 * is the hand-owned equivalent. Same contract (`isOpen` / `onClose`), same place
 * in the flow.
 *
 * ── Why this renders nothing ────────────────────────────────────────────────
 *
 * It used to be a modal: a heading, a paragraph explaining that Mero Sign runs
 * against a node you control, a `<CalimeroConnectButton />`, and a Cancel. So
 * pressing "Connect to node" on the landing page opened a dialog whose only
 * real content was ANOTHER button you had to press to reach the node picker.
 * Two clicks and a wall of text between the person and the one control that
 * does anything, and the text said nothing the picker does not say better.
 *
 * `useCalimero().login()` is what that button called. Calling it directly on
 * open means the picker appears immediately, which is what "Connect to node"
 * already promised. There is no dialog left to render — the picker IS the
 * dialog — so this component's whole job is to fire `login()` once and hand
 * control back.
 *
 * ── Why the ref ─────────────────────────────────────────────────────────────
 *
 * `login()` opens a window. Under React 19 StrictMode every effect runs twice
 * in development, and an effect keyed only on `isOpen` also re-fires whenever
 * the provider hands down a new `login` identity. Either one opens a second
 * picker over the first. The guard makes it once per open, and resets when the
 * popup closes so a cancelled connect can be retried.
 */
export default function ConnectPopup({ isOpen, onClose }: LoginPopupProps) {
  const { login } = useCalimero();
  const fired = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      fired.current = false;
      return;
    }
    if (fired.current) return;
    fired.current = true;
    login();
    // Our own overlay is done the moment the picker is up; leaving it mounted
    // would put a second backdrop behind the picker and swallow the click that
    // dismisses it.
    onClose();
  }, [isOpen, login, onClose]);

  return null;
}
