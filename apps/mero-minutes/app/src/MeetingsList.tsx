import { useMemo, useState } from "react";
import { CheckSquare, Clock, FileText } from "@calimero-network/mero-icons";
import type { MeetingView } from "./minutesApi";
import { formatDuration, formatWhen, platformName, searchMeetings } from "./lib/transcript";
import { EXTENSION_URL } from "./native";
import { PlatformMark } from "./PlatformMark";
import { PersonName } from "./names";
import { Icon } from "./ui";

/**
 * Every meeting in the workspace, newest first, with a search over titles.
 * Presentational: `MeetingsHome` reads the list, the tests hand it one.
 */
export function MeetingsList({
  meetings,
  error,
  onOpen,
}: {
  meetings: MeetingView[] | null;
  error?: string | null;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => (meetings ? searchMeetings(meetings, query) : null), [meetings, query]);

  if (error && !meetings) return <pre className="err">{error}</pre>;
  if (!meetings) {
    return (
      <section className="card" aria-busy="true">
        <p className="empty">Loading meetings…</p>
      </section>
    );
  }
  if (meetings.length === 0) return <GetTheExtension />;

  return (
    <section className="meetings" aria-label="Meetings">
      <div className="search">
        <Icon name="search" />
        <input
          type="search"
          aria-label="Search meetings"
          placeholder="Search meetings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {shown && shown.length === 0 && (
        <p className="empty" data-testid="no-match">
          No meeting title matches &ldquo;{query.trim()}&rdquo;.
        </p>
      )}
      <ul className="meeting-list">
        {shown?.map((m) => (
          <li key={m.id}>
            <button className="meeting-row" onClick={() => onOpen(m.id)} data-testid="meeting-row">
              <PlatformMark platform={m.platform} />
              <span className="meeting-main">
                <span className="meeting-title">
                  {m.title}
                  {m.live && <LiveBadge />}
                </span>
                <span className="meeting-meta">
                  <span>{formatWhen(m.startedAt)}</span>
                  <span className="dot" aria-hidden="true" />
                  <span>{platformName(m.platform)}</span>
                  <span className="dot" aria-hidden="true" />
                  <span>
                    by <PersonName account={m.recorder} />
                  </span>
                </span>
              </span>
              <span className="meeting-stats">
                <span title="Length">
                  <Clock size={14} aria-hidden="true" /> {m.durationMs ? formatDuration(m.durationMs) : "—"}
                </span>
                <span title="Words">
                  <FileText size={14} aria-hidden="true" /> {m.words.toLocaleString()}
                </span>
                <span title="Open action items" className={m.openActions ? "has-open" : undefined}>
                  <CheckSquare size={14} aria-hidden="true" /> {m.openActions}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LiveBadge() {
  return (
    <span className="live-badge" data-testid="live-badge">
      <span className="live-dot" aria-hidden="true" />
      Live
    </span>
  );
}

/** The empty workspace: what the extension does, and how to start. */
export function GetTheExtension() {
  return (
    <section className="card get-extension" data-testid="empty-meetings">
      <div className="get-extension-mark" aria-hidden="true">
        <Icon name="mic" size={26} />
      </div>
      <h2>Record your first meeting</h2>
      <p className="empty">
        The Minutes extension listens to a call in your browser and turns speech into text on your
        own laptop. The audio never leaves it; only the transcript is saved here, for your team.
      </p>
      <ol className="steps">
        <li>
          <span className="step-n">1</span>
          <span>
            <strong>Add the extension</strong> to Chrome or Brave.
          </span>
        </li>
        <li>
          <span className="step-n">2</span>
          <span>
            <strong>Sign in</strong> from the extension with this account and pick this workspace.
          </span>
        </li>
        <li>
          <span className="step-n">3</span>
          <span>
            <strong>Join a call</strong> on Google Meet, Zoom or Teams and press Record.
          </span>
        </li>
      </ol>
      <a className="btn primary" href={EXTENSION_URL} target="_blank" rel="noreferrer">
        <Icon name="puzzle" /> Get the extension
      </a>
    </section>
  );
}
