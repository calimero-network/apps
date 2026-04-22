import React, { useState, useEffect, useCallback } from "react";

interface Step {
  selector: string;
  title: string;
  description: string;
  pad?: number;
}

const STEPS: Step[] = [
  {
    selector: '[data-tutorial="node-url"]',
    title: "Node URL",
    description:
      "This shows which merod node you're connected to. Click it to change the URL — useful when switching between Node A and Node B.",
    pad: 8,
  },
  {
    selector: '[data-tutorial="open-node-b"]',
    title: "Connecting a Second Node",
    description:
      "Click to get the Node B URL. You can open it in an incognito window, a different browser, or run a second frontend on port 5174 with its own VITE_NODE_URL.",
    pad: 6,
  },
  {
    selector: '[data-tutorial="ctx-id"]',
    title: "Context ID",
    description:
      "The active context running inside your node. All operations — KV, CRDT, storage — run against this context. Click to copy the ID.",
    pad: 6,
  },
  {
    selector: '[data-tutorial="ctx-select"]',
    title: "Switch Active Context",
    description:
      "This dropdown appears when your node has more than one context. Each entry shows a context ID prefix and its app ID. Selecting one switches all operations — KV, CRDT, storage — to that context. Use this to toggle between different running instances of your app.",
    pad: 6,
  },
  {
    selector: '[data-tutorial="nav-concepts"]',
    title: "How It Works",
    description:
      "Start here. Explains Calimero's architecture: what a context is, how nodes sync, and how the frontend connects.",
    pad: 6,
  },
  {
    selector: '[data-tutorial="nav-setup"]',
    title: "Setup Wizard",
    description:
      "Step-by-step guide to create a namespace, install the app bundle, create a context, and invite a second node. Run this first on a fresh install.",
    pad: 6,
  },
  {
    selector: '[data-tutorial="nav-kv"]',
    title: "KV Operations",
    description:
      "Test key-value reads and writes stored inside the context's WASM runtime. Changes persist between sessions and replicate to other nodes.",
    pad: 6,
  },
  {
    selector: '[data-tutorial="nav-counters"]',
    title: "CRDT Sync",
    description:
      "Conflict-free Replicated Data Types. Counters, registers, sets, and maps in this section sync automatically between Node A and Node B without conflicts.",
    pad: 6,
  },
  {
    selector: '[data-tutorial="logout"]',
    title: "Logout",
    description:
      "Disconnects from the current node and returns you to the connect screen. Your node keeps running in the background.",
    pad: 6,
  },
];

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function CardPosition(rect: Rect): { top: number; left: number } {
  const CARD_W = 350;
  const CARD_H = 200;
  const GAP = 14;

  const spaceBelow = window.innerHeight - (rect.top + rect.height);
  const placeAbove = spaceBelow < CARD_H + GAP && rect.top > CARD_H + GAP;

  const top = placeAbove
    ? rect.top - CARD_H - GAP
    : rect.top + rect.height + GAP;

  let left = rect.left + rect.width / 2 - CARD_W / 2;
  left = Math.max(16, Math.min(left, window.innerWidth - CARD_W - 16));

  return { top, left };
}

interface CardProps {
  step: Step;
  index: number;
  total: number;
  rect: Rect;
  onPrev?: () => void;
  onNext: () => void;
  onClose: () => void;
}

function TutorialCard({ step, index, total, rect, onPrev, onNext, onClose }: CardProps) {
  const { top, left } = CardPosition(rect);

  const btnBase: React.CSSProperties = {
    background: "none",
    border: "1px solid var(--color-border)",
    borderRadius: 5,
    color: "var(--color-text-muted)",
    fontSize: 12,
    padding: "5px 12px",
    cursor: "pointer",
    transition: "border-color 0.15s, color 0.15s",
  };

  const btnPrimary: React.CSSProperties = {
    ...btnBase,
    background: "var(--color-brand-600)",
    borderColor: "var(--color-brand-600)",
    color: "#000",
  };

  return (
    <div
      style={{
        position: "fixed",
        left,
        top,
        width: 350,
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-brand-600)",
        borderRadius: 10,
        padding: "18px 20px 14px",
        zIndex: 9020,
        boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
        pointerEvents: "all",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontWeight: 700,
            fontSize: 14,
            color: "var(--color-text-primary)",
          }}
        >
          {step.title}
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            fontSize: 17,
            lineHeight: 1,
            padding: 0,
            marginLeft: 8,
            flexShrink: 0,
          }}
          title="Close tutorial"
        >
          ✕
        </button>
      </div>

      {/* Description */}
      <p
        style={{
          color: "var(--color-text-muted)",
          fontSize: 13,
          lineHeight: 1.65,
          margin: "0 0 16px",
        }}
      >
        {step.description}
      </p>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          {index + 1} / {total}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {onPrev && (
            <button style={btnBase} onClick={onPrev}>
              ← Prev
            </button>
          )}
          <button style={btnPrimary} onClick={onNext}>
            {index === total - 1 ? "Done ✓" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TutorialButton() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [btnHovered, setBtnHovered] = useState(false);

  const refreshRect = useCallback(
    (idx: number) => {
      const el = document.querySelector(STEPS[idx].selector);
      if (el) {
        const r = el.getBoundingClientRect();
        const pad = STEPS[idx].pad ?? 6;
        setRect({
          left: r.left - pad,
          top: r.top - pad,
          width: r.width + pad * 2,
          height: r.height + pad * 2,
        });
      } else {
        setRect(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    refreshRect(step);
    const onResize = () => refreshRect(step);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, step, refreshRect]);

  function startTutorial() {
    setStep(0);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setRect(null);
  }

  function findStep(from: number, dir: 1 | -1): number {
    let i = from;
    while (i >= 0 && i < STEPS.length) {
      if (document.querySelector(STEPS[i].selector)) return i;
      i += dir;
    }
    return -1;
  }

  function goNext() {
    const next = findStep(step + 1, 1);
    if (next === -1) {
      close();
    } else {
      setStep(next);
      refreshRect(next);
    }
  }

  function goPrev() {
    const prev = findStep(step - 1, -1);
    if (prev >= 0) {
      setStep(prev);
      refreshRect(prev);
    }
  }

  return (
    <>
      {/* Floating ? button */}
      <button
        onClick={startTutorial}
        onMouseEnter={() => setBtnHovered(true)}
        onMouseLeave={() => setBtnHovered(false)}
        title="Open tutorial"
        style={{
          position: "fixed",
          bottom: 40,
          right: 40,
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: btnHovered
            ? "var(--color-brand-600)"
            : "var(--color-bg-card)",
          border: "2px solid var(--color-brand-600)",
          color: btnHovered ? "#000" : "var(--color-brand-600)",
          fontSize: 22,
          fontWeight: 700,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: btnHovered
            ? "0 0 0 7px rgba(99,102,241,0.18), 0 4px 20px rgba(0,0,0,0.45)"
            : "0 2px 14px rgba(0,0,0,0.35)",
          transform: btnHovered ? "scale(1.13)" : "scale(1)",
          transition: "all 0.2s ease",
          zIndex: 9000,
          lineHeight: 1,
        }}
      >
        ?
      </button>

      {/* Tutorial active */}
      {open && (
        <>
          {rect ? (
            <>
              {/* Spotlight cutout */}
              <div
                style={{
                  position: "fixed",
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                  borderRadius: 8,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.75)",
                  zIndex: 9010,
                  pointerEvents: "none",
                  outline: "2px solid var(--color-brand-600)",
                  outlineOffset: 1,
                }}
              />

              {/* Explanation card */}
              <TutorialCard
                step={STEPS[step]}
                index={step}
                total={STEPS.length}
                rect={rect}
                onPrev={step > 0 ? goPrev : undefined}
                onNext={goNext}
                onClose={close}
              />
            </>
          ) : (
            /* Element not found — show a centered fallback card */
            <>
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,0.75)",
                  zIndex: 9010,
                  pointerEvents: "none",
                }}
              />
              <div
                style={{
                  position: "fixed",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%,-50%)",
                  width: 350,
                  zIndex: 9020,
                }}
              >
                <TutorialCard
                  step={STEPS[step]}
                  index={step}
                  total={STEPS.length}
                  rect={{ left: window.innerWidth / 2 - 175, top: window.innerHeight / 2 - 50, width: 350, height: 100 }}
                  onPrev={step > 0 ? goPrev : undefined}
                  onNext={goNext}
                  onClose={close}
                />
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
