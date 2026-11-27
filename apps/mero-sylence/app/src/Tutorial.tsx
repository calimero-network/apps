import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./ui";
import "./tutorial.css";

const SEEN_KEY = "mero-sylence:tutorial-seen";

/** Whether this browser has seen the tutorial (it opens by itself the first time). */
export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* a per-browser convenience */
  }
}

// ── the drawings: small scenes that loop while their step is shown ──────────

function SceneExtension() {
  return (
    <div className="ts ts-ext" aria-hidden="true">
      <div className="ts-browser">
        <div className="ts-bar">
          <i />
          <i />
          <i />
          <span className="ts-omni" />
          <span className="ts-ext-slot">
            <img src="./favicon.svg" alt="" width={18} height={18} />
          </span>
        </div>
        <div className="ts-page">
          <span className="ts-store-card">
            <img src="./favicon.svg" alt="" width={28} height={28} />
            <b>Sylence</b>
            <span className="ts-add">Add to Chrome</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function SceneWorkspace() {
  return (
    <div className="ts ts-ws" aria-hidden="true">
      <div className="ts-key">
        <Icon name="key" size={22} />
        <span className="ts-tick">
          <Icon name="check" size={12} />
        </span>
      </div>
      <div className="ts-form">
        <span className="ts-label">Workspace name</span>
        <span className="ts-input">
          <span className="ts-typed">Launch team</span>
          <span className="ts-caret" />
        </span>
        <span className="ts-btn">Start a workspace</span>
      </div>
    </div>
  );
}

function SceneRecord() {
  return (
    <div className="ts ts-rec" aria-hidden="true">
      <div className="ts-tiles">
        {["J", "E", "S", "Y"].map((l, i) => (
          <span key={l} className="ts-tile" style={{ animationDelay: `${i * 0.9}s` }}>
            <span className="ts-avatar">{l}</span>
          </span>
        ))}
      </div>
      <div className="ts-recbar">
        <span className="ts-dot" /> Recording · 00:42
        <span className="ts-levels">
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

function SceneSaved() {
  return (
    <div className="ts ts-saved" aria-hidden="true">
      <div className="ts-laptop">
        <span className="ts-chip">speech → text</span>
      </div>
      <div className="ts-flow">
        <i />
        <i />
        <i />
      </div>
      <div className="ts-vault">
        <Icon name="key" size={20} />
        <span>Secure enclave</span>
      </div>
    </div>
  );
}

function ScenePlayback() {
  return (
    <div className="ts ts-play" aria-hidden="true">
      <div className="ts-player">
        <span className="ts-pbtn">
          <Icon name="pause" size={12} />
        </span>
        <span className="ts-track">
          <i />
        </span>
      </div>
      <ol className="ts-lines">
        <li>
          <b className="ts-who amber">Eve</b> Let&apos;s lock the roadmap.
        </li>
        <li>
          <b className="ts-who blue">John</b> Pricing goes first.
        </li>
        <li>
          <b className="ts-who green">Sam</b> I&apos;ll update it tomorrow.
        </li>
      </ol>
    </div>
  );
}

function SceneTeam() {
  return (
    <div className="ts ts-team" aria-hidden="true">
      <div className="ts-share">
        <i className="amber" />
        <i className="blue" />
        <i className="green" />
      </div>
      <ul className="ts-todos">
        <li>
          <span className="ts-check" /> Send the deck · John
        </li>
        <li>
          <span className="ts-check" /> Update pricing · Sam
        </li>
      </ul>
      <div className="ts-people">
        <span className="amber">E</span>
        <span className="blue">J</span>
        <span className="green">S</span>
        <span className="ts-plus">
          <Icon name="plus" size={12} />
        </span>
      </div>
    </div>
  );
}

const STEPS: { title: string; body: string; scene: ReactNode }[] = [
  {
    title: "Add the extension",
    body: "Sylence records calls through a small extension for Chrome and Brave. Install it once from the Get the extension page.",
    scene: <SceneExtension />,
  },
  {
    title: "Sign in and pick a workspace",
    body: "Sign in with your passkey, no password. A workspace holds your team's meetings; start one or join with an invite link.",
    scene: <SceneWorkspace />,
  },
  {
    title: "Record the call",
    body: "Open Google Meet, Zoom or Teams in the browser, click the Sylence icon and press Record. No bot joins the call.",
    scene: <SceneRecord />,
  },
  {
    title: "It's saved, privately",
    body: "Speech becomes text on your laptop. The transcript and recording go to your workspace, sealed in a secure enclave only your team can open.",
    scene: <SceneSaved />,
  },
  {
    title: "Read it and play it back",
    body: "Every meeting has a transcript with who said what. Uploaded recordings play back with the line being said highlighted; click any line to jump there.",
    scene: <ScenePlayback />,
  },
  {
    title: "Act on it together",
    body: "See who talked and how much, tick off action items, search past calls, and invite your team from People.",
    scene: <SceneTeam />,
  },
];

/**
 * How Sylence works, step by step: a dialog with a drawing per step, Back
 * and Next (arrow keys and a swipe too), dots to jump. It opens by itself the
 * first time someone signs in on this browser; the menu's "Show tutorial"
 * opens it again. Closing it, on any step, marks it seen.
 */
export function Tutorial({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const touch = useRef<number | null>(null);
  const pressedOutside = useRef(false);
  const last = STEPS.length - 1;

  const close = useCallback(() => {
    markSeen();
    onClose();
  }, [onClose]);

  const go = useCallback(
    (to: number) => {
      const next = Math.max(0, Math.min(last, to));
      setDir(next >= step ? 1 : -1);
      setStep(next);
    },
    [last, step],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setStep(0);
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    } else if (!open && el.open) {
      if (typeof el.close === "function") el.close();
      else el.removeAttribute("open");
    }
  }, [open]);

  const s = STEPS[step]!;
  return (
    <dialog
      ref={ref}
      className="tutorial"
      aria-labelledby="tutorial-title"
      data-testid="tutorial"
      onClose={close}
      onMouseDown={(e) => (pressedOutside.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (pressedOutside.current && e.target === e.currentTarget) close();
        pressedOutside.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(step + 1);
        if (e.key === "ArrowLeft") go(step - 1);
      }}
      onTouchStart={(e) => (touch.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const from = touch.current;
        const to = e.changedTouches[0]?.clientX;
        touch.current = null;
        if (from === null || to === undefined || Math.abs(to - from) < 48) return;
        go(to < from ? step + 1 : step - 1);
      }}
    >
      {open && (
        <div className="tutorial-body">
          <button type="button" className="icon-btn tutorial-x" aria-label="Close tutorial" onClick={close}>
            <Icon name="x" />
          </button>
          <div className={`tutorial-stage ${dir === 1 ? "fwd" : "back"}`} key={step}>
            {s.scene}
          </div>
          <div className="tutorial-copy" key={`c${step}`}>
            <span className="tutorial-step">
              Step {step + 1} of {STEPS.length}
            </span>
            <h2 id="tutorial-title">{s.title}</h2>
            <p>{s.body}</p>
          </div>
          <div className="tutorial-nav">
            <button type="button" className="btn ghost" onClick={() => go(step - 1)} disabled={step === 0}>
              <Icon name="left" /> Back
            </button>
            <div className="tutorial-dots" role="tablist" aria-label="Tutorial steps">
              {STEPS.map((t, i) => (
                <button
                  key={t.title}
                  type="button"
                  role="tab"
                  aria-selected={i === step}
                  aria-label={`Step ${i + 1}: ${t.title}`}
                  className={i === step ? "on" : ""}
                  onClick={() => go(i)}
                />
              ))}
            </div>
            {step < last ? (
              <button type="button" className="btn primary" onClick={() => go(step + 1)} autoFocus>
                Next <Icon name="right" />
              </button>
            ) : (
              <button type="button" className="btn primary" onClick={close}>
                Get started
              </button>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
