/**
 * Mounts the node picker once, and lets anything below it open the picker.
 *
 * mero-react does not expose an "open the login modal" call — by design. The
 * app owns the modal's open state and renders `LoginModal` itself, which is
 * exactly what mero-design's landing page does:
 *
 *     const { connectToNode } = useMero();
 *     <LoginModal isOpen onClose onConnect={(url) => { onClose(); connectToNode(url); }} />
 *
 * Mero Sign has THREE places that need to open it — the landing CTA, the
 * signed-out app route, and the header — so the modal is mounted once here and
 * they call `openLogin()`, rather than each keeping its own copy of the state
 * and its own `LoginModal`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { LoginModal, useMero } from '@calimero-network/mero-react';

const OpenLogin = createContext<() => void>(() => {});

/** Open the node picker. A no-op above `LoginGate`, never a crash. */
export function useOpenLogin(): () => void {
  return useContext(OpenLogin);
}

export function LoginGate({ children }: { children: ReactNode }) {
  const { connectToNode } = useMero();
  const [open, setOpen] = useState(false);
  const openLogin = useCallback(() => setOpen(true), []);
  const value = useMemo(() => openLogin, [openLogin]);

  return (
    <OpenLogin.Provider value={value}>
      {children}
      <LoginModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onConnect={(url) => {
          // Closed first: `connectToNode` navigates away to the node's sign-in,
          // and a modal still mounted over a page that is leaving flashes.
          setOpen(false);
          connectToNode(url);
        }}
      />
    </OpenLogin.Provider>
  );
}
