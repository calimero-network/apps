// Presentational chrome shared by every in-app screen: the three-column shell
// (nav rail · timeline · sidebar), avatars, the account chip and a copyable
// technical id. No data flow lives here — each page still owns what it renders
// and what its buttons do.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  InfoIcon,
  LogOutIcon,
  MessageIcon,
  MoreIcon,
} from "./icons";

/** The brand tile + wordmark. */
export function Brand() {
  return (
    <span className="ui-brand">
      <span className="ui-brandMark" aria-hidden="true">
        <MessageIcon size={16} />
      </span>
      <span className="ui-brandName">Mero Forum</span>
    </span>
  );
}

/**
 * The app shell.
 *
 *   rail    — nav items, the primary call to action, the account chip
 *   header  — sticky translucent bar at the top of the centre column
 *   aside   — right-hand sidebar cards
 *
 * Below 1000px the sidebar flows under the timeline; below 700px the rail
 * becomes a bottom tab bar.
 */
export function Shell({
  nav,
  cta,
  account,
  header,
  aside,
  children,
}: {
  nav: ReactNode;
  cta?: ReactNode;
  account?: ReactNode;
  header: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="x-shell">
      <aside className="x-rail" aria-label="Main">
        <div className="x-railInner">
          <div className="x-railBrand">
            <Brand />
          </div>
          <nav className="x-nav">{nav}</nav>
          {cta && <div className="x-cta">{cta}</div>}
          <div className="x-railGrow" />
          {account && <div className="x-account">{account}</div>}
        </div>
      </aside>
      <main className="x-main">
        <div className="x-head">{header}</div>
        {children}
      </main>
      {aside && <aside className="x-aside">{aside}</aside>}
    </div>
  );
}

/** One nav row in the rail. Renders a <button>, or wraps a link via `as`. */
export function NavItem({
  icon,
  label,
  active,
  onClick,
  testId,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="x-navItem"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      data-testid={testId}
      disabled={disabled}
    >
      <span className="x-navIcon">{icon}</span>
      <span className="x-navLabel">{label}</span>
    </button>
  );
}

/** A sidebar card on the subtle surface. */
export function SideCard({
  title,
  children,
}: {
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="x-sideCard">
      {title && <h2 className="x-sideTitle">{title}</h2>}
      {children}
    </section>
  );
}

/** Soft, deterministic colour per name, so authors are told apart at a glance. */
function toneOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % 6;
}

/** Initials circle. */
export function Avatar({
  label,
  seed,
  anonymous,
  size = 40,
  square,
  icon,
}: {
  label: string;
  /** What the colour is derived from — the account id, ideally. */
  seed?: string;
  anonymous?: boolean;
  size?: number;
  /** Rounded square, for spaces and forums rather than people. */
  square?: boolean;
  icon?: ReactNode;
}) {
  const clean = label.trim();
  const initials = anonymous
    ? clean.slice(0, 2)
    : clean
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0] ?? "")
        .join("") || "?";
  return (
    <span
      className="ui-avatar"
      data-tone={toneOf(seed ?? clean)}
      data-square={square ? "true" : undefined}
      data-anonymous={anonymous ? "true" : undefined}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
      }}
      aria-hidden="true"
    >
      {icon ?? initials.toUpperCase()}
    </span>
  );
}

/**
 * Who you are and which node you are on, with the way out. Shown at the foot
 * of the rail. `onLogout` is whatever the page already called.
 */
export function AccountChip({
  name,
  host,
  hostTitle,
  onLogout,
  logoutTestId,
  hostTestId,
}: {
  name?: string;
  host: string | null;
  hostTitle?: string;
  onLogout: () => void;
  logoutTestId?: string;
  hostTestId?: string;
}) {
  const display = name?.trim() || "Your node";
  return (
    <div className="x-accountChip">
      <Avatar label={display} seed={display} size={36} />
      <span className="x-accountText">
        <span className="x-accountName">{display}</span>
        {host && (
          <span
            className="x-accountHost"
            title={hostTitle ?? host}
            data-testid={hostTestId}
          >
            <span className="ui-dot" aria-hidden="true" />
            {host}
          </span>
        )}
      </span>
      <button
        type="button"
        className="ui-iconBtn x-logout"
        onClick={onLogout}
        data-testid={logoutTestId}
        title="Sign out of this node"
        aria-label="Log out"
      >
        <LogOutIcon size={18} />
      </button>
    </div>
  );
}

/**
 * A technical id, truncated in mono, with a Copy button that flips to
 * "Copied" for a moment. The flip is presentation-only state.
 */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = () => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  return (
    <div className="ui-copyField">
      <span className="ui-copyLabel">{label}</span>
      <span className="ui-copyRow">
        <code className="ui-copyValue" title={value}>
          {value}
        </code>
        <button
          type="button"
          className="ui-iconBtn ui-copyBtn"
          onClick={copy}
          aria-label={copied ? "Copied" : `Copy ${label}`}
          title={copied ? "Copied" : "Copy"}
          data-copied={copied ? "true" : undefined}
        >
          {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
        </button>
      </span>
    </div>
  );
}

/** Technical ids, tucked behind a disclosure. */
export function TechDetails({
  rows,
  note,
}: {
  rows: { label: string; value: string | null | undefined }[];
  note?: ReactNode;
}) {
  const present = rows.filter(
    (r): r is { label: string; value: string } => !!r.value,
  );
  if (present.length === 0) return null;
  return (
    <details className="ui-details">
      <summary>
        <InfoIcon size={15} />
        Details
        <ChevronDownIcon size={15} className="ui-chev" />
      </summary>
      <div className="ui-detailsBody">
        {present.map((r) => (
          <CopyField key={r.label} label={r.label} value={r.value} />
        ))}
        {note && <p className="ui-detailsNote">{note}</p>}
      </div>
    </details>
  );
}

/**
 * The "…" button and the menu behind it. Closes on an outside click and on
 * Escape (focus returns to the trigger). Open/closed is presentation state.
 */
export function Menu({
  label = "More actions",
  testId,
  children,
}: {
  label?: string;
  testId?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="ui-menuWrap" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="ui-iconBtn"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <MoreIcon size={18} />
      </button>
      {open && (
        <div className="ui-menu" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
