import { useEffect, useRef, useState } from "react";
import { appLook } from "./apps";
import { FRONTENDS } from "./links";

/**
 * The apps the launcher lists, in its order, by the key their look is filed
 * under. `installs` are the keys an installed package files under when it is
 * not the same (`com.calimero.mero-issue-tracker` → `issue-tracker`).
 */
export const LAUNCHER_APPS: { key: string; installs: string[] }[] = [
  { key: "chat", installs: ["chat"] },
  { key: "calendar", installs: ["calendar"] },
  { key: "sheets", installs: ["sheets"] },
  { key: "issues", installs: ["issues", "issue-tracker"] },
  { key: "docs", installs: ["docs", "drive-docs"] },
  { key: "crm", installs: ["crm"] },
  { key: "sign", installs: ["sign"] },
  { key: "pass", installs: ["pass"] },
  { key: "design", installs: ["design"] },
  { key: "updates", installs: ["updates"] },
  { key: "vote", installs: ["vote"] },
  { key: "forum", installs: ["forum"] },
  { key: "stream", installs: ["stream"] },
];

/**
 * The launcher's two groups: the apps on your node, and the rest it supports.
 * With no word from the node yet (or in the demo) every app counts as yours,
 * so the launcher never hides one behind an Install it may not need.
 */
export function launcherGroups(installed: string[] | null): { yours: string[]; more: string[] } {
  const apps = LAUNCHER_APPS.filter((a) => FRONTENDS[a.key]);
  if (!installed) return { yours: apps.map((a) => a.key), more: [] };
  const on = (a: (typeof apps)[number]) => a.installs.some((k) => installed.includes(k));
  return { yours: apps.filter(on).map((a) => a.key), more: apps.filter((a) => !on(a)).map((a) => a.key) };
}

/**
 * The apps grid in the top bar: every app Hyperfeed supports, one tile each,
 * as a launcher. A tile for an app on your node opens it in a new tab, where
 * it signs in to your node with a key of its own: Hyperfeed never hands its
 * session over, since the node lets a refresh token be used once and a shared
 * one logs both apps out. One that isn't installed yet takes you to
 * Settings → Controls to install it.
 */
export function AppLauncher({
  installed,
  href,
  onInstall,
}: {
  /** The apps installed on your node, by key; null in the demo, or until the node says. */
  installed: string[] | null;
  /** Where an app opens. */
  href: (app: string) => string | null;
  /** Go where an app not on your node is installed. */
  onInstall?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const click = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (panel.current && t && !panel.current.contains(t) && !t.closest?.(".launcher-button")) setOpen(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", click);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", click);
    };
  }, [open]);

  const { yours, more } = launcherGroups(installed);
  const launch = (app: string) => {
    const url = href(app);
    setOpen(false);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };
  const tiles = (keys: string[], installable: boolean) => (
    <ul className="launcher-grid">
      {keys.map((key) => {
        const look = appLook(key);
        return (
          <li key={key}>
            <button
              type="button"
              className={`launcher-tile${installable ? " off" : ""}`}
              title={installable ? `${look.name} isn't on your node yet: install it` : `Open ${look.name}`}
              onClick={() => {
                if (!installable) return launch(key);
                setOpen(false);
                onInstall?.();
              }}
            >
              {look.icon ? (
                <img className="launcher-icon" src={look.icon} alt="" width={40} height={40} />
              ) : (
                <span className="launcher-icon launcher-letters" style={{ background: look.color }} aria-hidden="true">
                  {look.letters}
                </span>
              )}
              <span className="launcher-name">{look.name}</span>
              {installable && <span className="launcher-install">Install</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="launcher-wrap">
      <button
        type="button"
        className="icon-button launcher-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Apps"
        title="Apps"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          {[5, 12, 19].flatMap((y) => [5, 12, 19].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" />))}
        </svg>
      </button>
      {open && (
        <div ref={panel} className="launcher-panel" role="dialog" aria-label="Apps">
          <section className="launcher-section">
            <h2>{installed ? "On your node" : "Apps"}</h2>
            {yours.length > 0 ? tiles(yours, false) : <p className="launcher-note">No apps on your node yet.</p>}
          </section>
          {more.length > 0 && (
            <section className="launcher-section launcher-more">
              <h2>More apps</h2>
              {tiles(more, Boolean(onInstall))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
