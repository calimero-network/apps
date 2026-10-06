// Small presentational pieces shared by the panels. No data, no calls — only
// markup and the local state a copy button needs to say "Copied".

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangleIcon, CheckIcon, CopyIcon, InfoIcon, ShieldCheckIcon } from "./icons";

export function shortId(id: string, head = 6, tail = 4) {
  return id.length > head + tail + 1 ? `${id.slice(0, head)}…${id.slice(-tail)}` : id;
}

/** Icon-only copy button. Flips to a check for a moment after a copy. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="icon-btn sm"
      title={done ? "Copied" : label}
      aria-label={done ? "Copied" : label}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => setDone(true),
          () => undefined,
        );
      }}
    >
      {done ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
    </button>
  );
}

/** A long id on one line: truncated, monospace, with a copy button. */
export function IdField({ value, label }: { value: string; label?: string }) {
  return (
    <span className="id-field" title={value}>
      <code className="mono">{value}</code>
      <CopyButton value={value} label={label ? `Copy ${label}` : "Copy"} />
    </span>
  );
}

type Tone = "success" | "danger" | "warning" | "info";

const toneIcon: Record<Tone, ReactNode> = {
  success: <ShieldCheckIcon size={18} />,
  danger: <AlertTriangleIcon size={18} />,
  warning: <AlertTriangleIcon size={18} />,
  info: <InfoIcon size={18} />,
};

export function Callout({
  tone,
  icon,
  children,
  className = "",
}: {
  tone: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`callout ${tone} ${className}`}>
      <span className="callout-icon">{icon ?? toneIcon[tone]}</span>
      <div className="callout-body">{children}</div>
    </div>
  );
}

export function IconTile({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <span className={`icon-tile ${accent ? "accent" : ""}`}>{children}</span>;
}
