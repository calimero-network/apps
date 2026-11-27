import { useEffect, useMemo, useState } from "react";
import { CheckSquare, Clock, FileText } from "@calimero-network/mero-icons";
import type { MeetingView } from "./sylenceApi";
import type { SearchHit, SearchResult } from "./generated/client";
import { formatClock, formatDuration, formatWhen, highlightParts, platformName, queryWords, searchMeetings, speakerLabel } from "./lib/transcript";
import { PlatformMark } from "./PlatformMark";
import { PersonName } from "./names";
import { Icon } from "./ui";

/** How long typing pauses before the transcripts are searched. */
export const SEARCH_DELAY_MS = 250;

/**
 * Every meeting in the workspace, newest first. The search box filters the
 * titles at once and, given `searchTranscripts` (the contract's `search`),
 * lists the transcript lines that match too; a line opens its meeting there.
 */
export function MeetingsList({
  meetings,
  error,
  onOpen,
  searchTranscripts,
}: {
  meetings: MeetingView[] | null;
  error?: string | null;
  onOpen: (id: string, seq?: number) => void;
  searchTranscripts?: (query: string) => Promise<SearchResult>;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => (meetings ? searchMeetings(meetings, query) : null), [meetings, query]);
  const lines = useTranscriptSearch(query, searchTranscripts);
  const searching = queryWords(query).length > 0;

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
      {searching && shown && shown.length === 0 && (!lines.hits || lines.hits.length === 0) && !lines.loading && (
        <p className="empty" data-testid="no-match">
          Nothing matches &ldquo;{query.trim()}&rdquo;{searchTranscripts ? " in titles or transcripts" : ""}.
        </p>
      )}
      {searching && shown && shown.length > 0 && <h3 className="list-label">Meetings</h3>}
      <ul className="meeting-list" hidden={shown?.length === 0}>
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
      {searching && searchTranscripts && (
        <TranscriptHits query={query} state={lines} onOpen={onOpen} />
      )}
    </section>
  );
}

interface SearchState {
  hits: SearchHit[] | null;
  more: boolean;
  loading: boolean;
  error: string | null;
}

/** The contract's search for `query`, after a pause in typing; the last answer wins. */
function useTranscriptSearch(query: string, search?: (q: string) => Promise<SearchResult>): SearchState {
  const [state, setState] = useState<SearchState>({ hits: null, more: false, loading: false, error: null });
  useEffect(() => {
    const q = query.trim();
    if (!search || queryWords(q).length === 0) {
      setState({ hits: null, more: false, loading: false, error: null });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    const t = setTimeout(() => {
      search(q)
        .then((r) => live && setState({ hits: r.hits.filter((h) => h.seq !== null && h.seq !== undefined), more: r.more, loading: false, error: null }))
        .catch((e: unknown) => live && setState({ hits: null, more: false, loading: false, error: e instanceof Error ? e.message : String(e) }));
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, search]);
  return state;
}

function TranscriptHits({
  query,
  state,
  onOpen,
}: {
  query: string;
  state: SearchState;
  onOpen: (id: string, seq?: number) => void;
}) {
  const words = queryWords(query);
  return (
    <section className="hits" aria-label="Matching lines" aria-busy={state.loading}>
      <h3 className="list-label">
        In transcripts
        {state.loading && <span className="dim"> · searching…</span>}
      </h3>
      {state.error && <p className="err">{state.error}</p>}
      {state.hits && state.hits.length === 0 && !state.loading && <p className="empty">No transcript line matches.</p>}
      {state.hits && state.hits.length > 0 && (
        <ul className="meeting-list">
          {state.hits.map((h) => (
            <li key={`${h.meetingId}-${h.seq}`}>
              <button className="meeting-row hit-row" data-testid="search-hit" onClick={() => onOpen(h.meetingId, h.seq ?? undefined)}>
                <span className="meeting-main">
                  <span className="hit-text">
                    {highlightParts(h.text ?? "", words).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
                  </span>
                  <span className="meeting-meta">
                    <span className="strong-meta">{h.title}</span>
                    <span className="dot" aria-hidden="true" />
                    <span>{formatWhen(h.startedAt)}</span>
                    <span className="dot" aria-hidden="true" />
                    <span className="mono">{formatClock(h.startMs ?? 0)}</span>
                    <span className="dot" aria-hidden="true" />
                    <span>{speakerLabel(h.speaker ?? "", "Recorder", h.name ?? "")}</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.more && <p className="dim">Showing the first {state.hits?.length ?? 0} lines. Add a word to narrow it down.</p>}
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
        The Sylence extension listens to a call in your browser and turns speech into text on your
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
      <a className="btn primary" href="#/install">
        <Icon name="puzzle" /> Get the extension
      </a>
    </section>
  );
}
