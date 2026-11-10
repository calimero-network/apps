import { useState } from "react";
import { useInstanceRelease } from "@calimero-apps/passkey";

import { getActive, setActive, type ActiveWorkspace } from "./lib/workspaceStore";
import { useMaybeSignedIn } from "./sessionContext";

/**
 * The workspace this browser has open (remembered across reloads:
 * `lib/workspaceStore`), and `open` to switch it.
 *
 * A workspace is an app instance, served the frontend of the release it runs
 * (`useInstanceRelease`): `leaving` is true while the page moves there. `open`
 * stores the workspace before it opens, so the other release reopens it.
 */
export function useActiveWorkspace(): {
  active: ActiveWorkspace | null;
  open: (w: ActiveWorkspace | null) => void;
  leaving: boolean;
} {
  const [active, setOpen] = useState<ActiveWorkspace | null>(() => getActive());
  const open = (w: ActiveWorkspace | null) => {
    setActive(w);
    setOpen(w);
  };
  const leaving = useInstanceRelease(useMaybeSignedIn()?.client, active?.appId);
  return { active, open, leaving };
}
