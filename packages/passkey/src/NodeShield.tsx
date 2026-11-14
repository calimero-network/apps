import "./nodeShield.css";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { CalimeroClient, NodeVerificationState } from "@calimero-network/mero-js";
import { checkAppCode, type AppCodeCheck } from "@calimero-apps/connect";

import { describeShield, shieldDetails, type ShieldKind, type ShieldView } from "./shieldView";
import { bindShieldSession, placeShield, readShield, useShieldStore, type ShieldApp } from "./nodeShieldStore";

const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;
const COPIED_MS = 2_000;
const NODE_POLL_MS = 1_000; // how often to notice that the client failed over
const EDGE_PX = 12; // the popover's distance from the viewport's edge
const GAP_PX = 8; // and from the chip

/** An unreachable node is asked again after 2 s, 4 s, 8 s, up to 30 s. */
const retryDelay = (attempt: number) => Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);

/** The check's outcome, or `null` for a client that cannot be checked: it stays "checking" instead of taking the app down or retrying. */
async function check(client: CalimeroClient): Promise<NodeVerificationState | null> {
  try {
    return await client.verify();
  } catch {
    return null;
  }
}

function peek(client: CalimeroClient | null): NodeVerificationState {
  let known: NodeVerificationState | undefined;
  try {
    known = client?.verification();
  } catch {
    // A client that cannot say is still being checked.
  }
  return known ?? { status: "checking", url: client?.nodeUrl ?? "" };
}

/** The check of the node in use, asked again after a failure to reach it, a failover, and whenever `refresh` is called. */
function useNodeVerification(client: CalimeroClient | null): [NodeVerificationState, () => void] {
  const [state, setState] = useState(() => peek(client));
  const [round, setRound] = useState(0);
  const [url, setUrl] = useState(client?.nodeUrl);
  useEffect(() => {
    setUrl(client?.nodeUrl);
    if (!client) return;
    const poll = setInterval(() => setUrl(client.nodeUrl), NODE_POLL_MS);
    return () => clearInterval(poll);
  }, [client]);
  useEffect(() => {
    if (!client) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async (attempt: number) => {
      const next = await check(client);
      if (!live || !next) return;
      setState(next);
      if (next.status === "unreachable") timer = setTimeout(() => void run(attempt + 1), retryDelay(attempt));
    };
    setState(peek(client));
    void run(0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, round, url]);
  // Never describe a node the client has moved on from: compared with the node in use now, not the last poll.
  const inUse = client?.nodeUrl;
  const shown: NodeVerificationState = inUse && state.url !== inUse ? { status: "checking", url: inUse } : state;
  return [shown, useCallback(() => setRound((n) => n + 1), [])];
}

/** The app's code check of verified node `url`, run when the popover opens and shown only while that node is still the one in use. */
function useAppCode(client: CalimeroClient | null, app: ShieldApp | null, url: string | null): AppCodeCheck | null {
  const [result, setResult] = useState<{ client: CalimeroClient; app: ShieldApp; url: string; code: AppCodeCheck } | null>(null);
  useEffect(() => {
    if (!client || !app || !url) return;
    let live = true;
    void checkAppCode(client, app.id, app.source).then((code) => {
      if (live && client.nodeUrl === url) setResult({ client, app, url, code });
    });
    return () => {
      live = false;
    };
  }, [client, app, url]);
  const current = result?.client === client && result?.app === app && result?.url === url && client?.nodeUrl === url;
  return current ? result.code : null;
}

/** Where the popover sits: right edges aligned with the chip, below it or above when that is where the room is, inside the viewport. */
function usePlacement(open: boolean, chip: React.RefObject<HTMLElement | null>, pop: React.RefObject<HTMLElement | null>) {
  const [at, setAt] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!chip.current || !pop.current) return;
      const anchor = chip.current.getBoundingClientRect();
      const { offsetWidth: width, scrollHeight: height } = pop.current;
      const below = window.innerHeight - anchor.bottom - GAP_PX - EDGE_PX;
      const above = anchor.top - GAP_PX - EDGE_PX;
      const room = height <= below || below >= above ? below : above;
      setAt({
        top: room === below ? anchor.bottom + GAP_PX : anchor.top - GAP_PX - Math.min(height, room),
        left: Math.min(Math.max(anchor.right - width, EDGE_PX), window.innerWidth - width - EDGE_PX),
        maxHeight: Math.max(room, 0),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    // The popover grows when its app code check arrives: re-place it so it stays clear of the chip.
    const grown = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (pop.current) grown?.observe(pop.current);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      grown?.disconnect();
    };
  }, [open, chip, pop]);
  return at;
}

function ShieldIcon({ kind }: { kind: ShieldKind }) {
  return (
    <svg className="cp-shield__icon" viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z" fill="currentColor" opacity=".18" />
      <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      {kind === "verified" && <path d="m8.5 12 2.4 2.4L15.5 9.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {kind === "refused" && <path d="m9.5 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
      {kind === "unsealed" && <path d="M12 8v4.5M12 15.6v.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

const Tick = () => (
  <svg className="cp-shield__tick" viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ExternalIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
    <path d="M14 4h6v6m0-6-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Popover({ view, id, placement, popRef }: { view: ShieldView; id: string; placement: ReturnType<typeof usePlacement>; popRef: React.RefObject<HTMLDivElement | null> }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  useEffect(() => {
    if (copied === "idle") return;
    const timer = setTimeout(() => setCopied("idle"), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () =>
    navigator.clipboard.writeText(shieldDetails(view)).then(
      () => setCopied("done"),
      () => setCopied("failed"),
    );
  return createPortal(
    <div
      ref={popRef}
      id={id}
      role="dialog"
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      className="cp-shield__pop"
      data-kind={view.kind}
      style={placement ?? { visibility: "hidden" }}
      data-testid="node-shield-popover"
    >
      <h3 id={`${id}-title`} className="cp-shield__title">
        <ShieldIcon kind={view.kind} />
        {view.title}
      </h3>
      <p className="cp-shield__sub">{view.sub}</p>
      <dl className="cp-shield__rows">
        {view.rows.map((row) => (
          <div key={row.label} className={row.tone === "bad" ? "cp-shield__row cp-shield__row--bad" : "cp-shield__row"}>
            <dt>{row.label}</dt>
            <dd className={row.mono ? "cp-shield__mono" : undefined} title={row.full}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {view.checks.length > 0 && (
        <ul className="cp-shield__checks">
          {view.checks.map((text) => (
            <li key={text}>
              <Tick />
              {text}
            </li>
          ))}
        </ul>
      )}
      <div className="cp-shield__buttons">
        {view.verifyUrl && (
          <a className="cp-shield__btn cp-shield__btn--primary" href={view.verifyUrl} target="_blank" rel="noopener noreferrer">
            Verify independently
            <ExternalIcon />
          </a>
        )}
        <button type="button" className="cp-shield__btn" onClick={() => void copy()}>
          {copied === "done" ? "Copied" : copied === "failed" ? "Could not copy" : "Copy details"}
        </button>
      </div>
      {view.verifyUrl && <p className="cp-shield__foot">Opens the public verifier, which re-checks this node from outside the app.</p>}
    </div>,
    document.body,
  );
}

function ShieldChip({ floating, answersOpen }: { floating: boolean; answersOpen: boolean }) {
  const { sessions, app, opens } = useShieldStore();
  const session = sessions[sessions.length - 1] ?? null;
  const client = session?.client ?? null;
  const [state, refresh] = useNodeVerification(client);
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const popId = useId();
  const seenOpens = useRef(opens);
  const placement = usePlacement(open, chip, pop);
  const code = useAppCode(client, app, open && state.status === "verified" ? state.url : null);

  useEffect(() => {
    if (opens === seenOpens.current) return;
    seenOpens.current = opens;
    if (answersOpen) setOpen(true);
  }, [opens, answersOpen]);

  useEffect(() => {
    if (!open) return;
    refresh();
    const close = (refocus: boolean) => {
      setOpen(false);
      if (refocus) chip.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(true);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!chip.current?.contains(target) && !pop.current?.contains(target)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, refresh]);

  // Focus waits for the placement: a popover still hidden for it cannot take focus.
  const placed = placement !== null;
  useEffect(() => {
    if (open && placed) pop.current?.focus();
  }, [open, placed]);

  if (!session) return null;
  const view = describeShield(state, { cluster: session.cluster, code });
  return (
    <span className={`cp-shield${floating ? " cp-shield--floating" : ""}`}>
      <button
        ref={chip}
        type="button"
        className="cp-shield__chip"
        data-kind={view.kind}
        aria-label={view.label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen((v) => !v)}
        data-testid="node-shield"
      >
        <ShieldIcon kind={view.kind} />
        <span className="cp-shield__label">{view.label}</span>
      </button>
      {open && <Popover view={view} id={popId} placement={placement} popRef={pop} />}
    </span>
  );
}

/** A header chip for the node this app talks to, with a popover of what the browser's check verified. */
export function NodeShield() {
  const id = useId();
  useLayoutEffect(() => placeShield(id), [id]);
  const { placed } = useShieldStore();
  return <ShieldChip floating={false} answersOpen={placed[0] === id} />;
}

function FloatingShield() {
  const { placed } = useShieldStore();
  return placed.length === 0 ? <ShieldChip floating answersOpen /> : null;
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
export function bindNodeShield(client: CalimeroClient, cluster: string): () => void {
  const unbind = bindShieldSession({ client, cluster });
  mountFloating();
  return () => {
    unbind();
    if (readShield().sessions.length === 0) unmountFloating();
  };
}
