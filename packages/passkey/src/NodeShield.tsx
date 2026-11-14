import "./nodeShield.css";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { CalimeroClient } from "@calimero-network/mero-js";

import { useAppCode, useNodeVerification } from "./nodeChecks";
import { useCopy } from "./useCopy";
import { ExternalIcon, ShieldIcon, Tick } from "./shieldIcons";
import { describeShield, shieldDetails, type ShieldView } from "./shieldView";
import { bindShieldSession, placeShield, readShield, useShieldStore } from "./nodeShieldStore";

const EDGE_PX = 12; // the popover's distance from the viewport's edge
const GAP_PX = 8; // and from the chip

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

function Popover({ view, id, placement, popRef }: { view: ShieldView; id: string; placement: ReturnType<typeof usePlacement>; popRef: React.RefObject<HTMLDivElement | null> }) {
  const [copied, copy] = useCopy();
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
        <button type="button" className="cp-shield__btn" onClick={() => copy(shieldDetails(view))}>
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
export function bindNodeShield(client: CalimeroClient, cluster: string, local = false): () => void {
  const unbind = bindShieldSession({ client, cluster, local });
  mountFloating();
  return () => {
    unbind();
    if (readShield().sessions.length === 0) unmountFloating();
  };
}
