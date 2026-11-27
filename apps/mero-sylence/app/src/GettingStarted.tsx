import { useState } from "react";
import { Icon } from "./ui";

const HIDE_KEY = "mero-sylence:tips-hidden";

function hidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * "Get started": four cards that explain what Sylence does and lead to it.
 * Shown on the meetings page until hidden; "Show tips" in the footer brings
 * them back.
 */
export function GettingStarted({
  onInstall,
  onUpload,
  onPeople,
}: {
  onInstall: () => void;
  onUpload: () => void;
  onPeople: () => void;
}) {
  const [gone, setGone] = useState(hidden);
  if (gone) return null;
  const hide = () => {
    try {
      localStorage.setItem(HIDE_KEY, "1");
    } catch {
      /* a per-browser convenience */
    }
    setGone(true);
  };
  const tips = [
    {
      icon: "puzzle" as const,
      step: "1",
      title: "Add the extension",
      body: "Sylence records calls through a small extension for Chrome and Brave. No bot joins the call.",
      action: "Get the extension",
      onClick: onInstall,
    },
    {
      icon: "mic" as const,
      step: "2",
      title: "Record a call",
      body: "Open Meet, Zoom or Teams, click the Sylence icon and press Record. Lines appear here as people talk.",
    },
    {
      icon: "upload" as const,
      step: "3",
      title: "Or upload a recording",
      body: "Drop in an mp3, m4a or wav. Sylence tells the voices apart and you can play it back line by line.",
      action: "Upload a recording",
      onClick: onUpload,
    },
    {
      icon: "users" as const,
      step: "4",
      title: "Bring your team",
      body: "Invite teammates to read transcripts, search past calls and tick off action items together.",
      action: "Invite people",
      onClick: onPeople,
    },
  ];
  return (
    <section className="tips" aria-labelledby="tips-title" data-testid="getting-started">
      <div className="tips-head">
        <h2 id="tips-title">Get started with Sylence</h2>
        <button type="button" className="btn small ghost" onClick={hide}>
          Hide tips
        </button>
      </div>
      <ol className="tips-grid">
        {tips.map((t) => (
          <li key={t.step} className="tip">
            <span className="tip-icon">
              <Icon name={t.icon} size={18} />
            </span>
            <span className="tip-step">Step {t.step}</span>
            <h3 className="tip-title">{t.title}</h3>
            <p>{t.body}</p>
            {t.action && t.onClick && (
              <button type="button" className="btn small" onClick={t.onClick}>
                {t.action}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Brings the tips back (the footer's "Show tips"). */
export function showTips(): void {
  try {
    localStorage.removeItem(HIDE_KEY);
  } catch {
    /* nothing kept */
  }
}
