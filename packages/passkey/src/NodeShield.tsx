import "./nodeShield.css";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CalimeroClient } from "@calimero-network/mero-js";
import { NodeShield as MeroNodeShield, type AppCodeChecker } from "@calimero-network/mero-react/node-shield";
import { checkAppCode } from "@calimero-apps/connect";

import { bindShieldSession, placeShield, readShield, useShieldStore } from "./nodeShieldStore";

/** The published shield for the last bound session, checking the registered app's code and opening on `openNodeShield()` when it `answersOpen`. */
function ShieldChip({ answersOpen, compactBelow, compact }: { answersOpen: boolean; compactBelow?: number; compact?: boolean }) {
  const { sessions, app, opens } = useShieldStore();
  const session = sessions[sessions.length - 1] ?? null;
  const [open, setOpen] = useState(false);
  const seenOpens = useRef(opens);
  const appCode = useMemo<AppCodeChecker | undefined>(
    () => (app ? (client, url) => checkAppCode(client, app.id, app.source, url) : undefined),
    [app],
  );

  useEffect(() => {
    if (opens === seenOpens.current) return;
    seenOpens.current = opens;
    if (answersOpen) setOpen(true);
  }, [opens, answersOpen]);

  if (!session) return null;
  return (
    <span className="cp-shield">
      <MeroNodeShield
        client={session.client}
        cluster={session.cluster}
        compactBelow={compactBelow}
        compact={compact}
        appCode={appCode}
        open={open}
        onOpenChange={setOpen}
      />
    </span>
  );
}

/**
 * A header chip for the node this app talks to, with a popover of what the browser's check verified.
 * With `compactBelow` it is the icon alone, a 28px circle named by its label, when the window is that many px wide or narrower.
 */
export function NodeShield({ compactBelow }: { compactBelow?: number } = {}) {
  const id = useId();
  useLayoutEffect(() => placeShield(id), [id]);
  const { placed } = useShieldStore();
  return <ShieldChip answersOpen={placed[0] === id} compactBelow={compactBelow} />;
}

function FloatingShield() {
  const { placed } = useShieldStore();
  return placed.length === 0 ? <ShieldChip answersOpen compact /> : null;
}

let floating: { root: Root; host: HTMLElement } | null = null;

function mountFloating() {
  if (floating) return;
  const host = document.createElement("div");
  host.setAttribute("data-node-shield-host", "");
  document.body.append(host);
  const root = createRoot(host);
  root.render(<FloatingShield />);
  floating = { root, host };
}

function unmountFloating() {
  const gone = floating;
  floating = null;
  // Not while the app's own render or effect cleanup is running.
  if (gone) queueMicrotask(() => (gone.root.unmount(), gone.host.remove()));
}

/** Show the shield for `client` in `cluster` until unbound: a floating chip unless an app placed a `<NodeShield />`. */
export function bindNodeShield(client: CalimeroClient, cluster: string, local = false): () => void {
  const unbind = bindShieldSession({ client, cluster, local });
  mountFloating();
  return () => {
    unbind();
    if (readShield().sessions.length === 0) unmountFloating();
  };
}
