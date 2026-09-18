import { CalimeroConnectButton } from '@calimero-network/calimero-client';
import type { LoginPopupProps } from './landingTypes';
import styles from '../app/AgreementsPage.module.css';

/**
 * The node-connection popup behind the landing page's "Connect to node".
 *
 * ⚠️ NOT the generated `loginPopup.tsx`. That one is written into every app
 * that depends on `@calimero-network/mero-react` and uses its `LoginModal` +
 * `connectToNode`; Mero Sign is the app still on
 * `@calimero-network/calimero-client`, so `landing:generate` skips it and this
 * is the hand-owned equivalent. Same contract (`isOpen` / `onClose`), same
 * place in the flow.
 *
 * ── Why this had to exist ───────────────────────────────────────────────────
 *
 * The only way to sign in to this app used to be a `<CalimeroConnectButton />`
 * at the bottom of the sidebar, and the landing page's CTA was wired to open
 * that sidebar. Deleting the sidebar therefore deleted the way in — which the
 * landing suite caught immediately ("connecting does not navigate to another
 * page" timed out on a button that no longer did anything).
 *
 * So the connect control survives the redesign, but as a MODAL you open when
 * you are signed out, rather than as permanent chrome. The thing the brief
 * asked to remove was the button that rendered connection state to somebody who
 * was already connected — it only ever appeared once you were signed in, at the
 * foot of a rail you had to open a hamburger to see.
 */
export default function ConnectPopup({ isOpen, onClose }: LoginPopupProps) {
  if (!isOpen) return null;

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        className={styles.modal}
        style={{ maxWidth: 400 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={styles.modalTitle}>Connect your node</h2>
        <p className={styles.modalDesc}>
          Mero Sign runs against a Calimero node you control. Point it at yours
          and it will sign you in and bring you back here.
        </p>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '8px 0',
          }}
          data-testid="connect-control"
        >
          <CalimeroConnectButton />
        </div>
        <div className={styles.modalRow}>
          <button className={styles.btnGhost} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
