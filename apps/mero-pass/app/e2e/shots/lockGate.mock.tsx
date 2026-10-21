// Aliased over src/components/LockGate. A fresh headless browser would stop at
// the first-run setup (protect the key, save a recovery key), so every shot of
// a vault would show that instead; the shots document the pages behind it.
import type { ReactNode } from 'react';

export default function LockGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
