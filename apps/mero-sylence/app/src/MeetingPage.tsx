import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckSquare, Clock, Download, FileText, Trash } from "@calimero-network/mero-icons";
import type { MeetingView, SegmentView } from "./sylenceApi";
import { deleteMeetingFully } from "./sylenceApi";
import { ActionItems } from "./ActionItems";
import { LiveBadge } from "./MeetingsList";
import { PlatformMark } from "./PlatformMark";
import { PersonName, useSpaceNames } from "./names";
import { displayName } from "./lib/people";
import {
  formatClock,
  formatDuration,
  formatWhen,
  highlightParts,
  markdownFileName,
  matchesAll,
  platformName,
  queryWords,
  speakerLabel,
  speakersIn,
  toMarkdown,
} from "./lib/transcript";
import { useTranscript } from "./useTranscript";
import { useRead, type Workspace } from "./useWorkspace";
import { Icon } from "./ui";
import { talkStats } from "./lib/stats";
import { activeIndex, speakerColor, speakerLanes } from "./lib/playback";
import { Player } from "./Player";
import { usePlayer } from "./usePlayer";
import { SpeakersCard } from "./SpeakersCard";
import { useRecording } from "./useRecording";
import { PeopleCard } from "./PeopleCard";
import { useAnalyze } from "./useAnalyze";
import type { Insights } from "./generated/client";

/** One meeting: its header, summary, transcript (live while recording) and action items. */
export function MeetingPage({
  workspace,
  meetingId,
  me,
  isOwner,
  onBack,
  focusSeq,
}: {
  workspace: Workspace;
  meetingId: string;
  me: string;
  /** The signed-in account owns the workspace: it may delete any meeting. */
  isOwner: boolean;
  onBack: () => void;
  /** A line to scroll to and mark (a search hit, `#/m/<id>/<seq>`). */
  focusSeq?: number;
}) {
  const meeting = useRead(workspace.client, workspace.version, (c) => c.getMeeting({ meetingId }), [meetingId]);
  const actions = useRead(workspace.client, workspace.version, (c) => c.listActions({ meetingId }), [meetingId]);
  const insights = useRead(workspace.client, workspace.version, (c) => c.insights({ meetingId }), [meetingId]);
  const transcript = useTranscript(workspace, meetingId);
  const { nameOf } = useSpaceNames();

  if (meeting.error && !meeting.data) {
    return (
      <section className="card">
        <BackButton onBack={onBack} />
        <p className="err" role="alert">
          {meeting.error}
        </p>
      </section>
    );
  }
  if (!meeting.data) {
    return (
      <section className="card" aria-busy="true">
        <p className="empty">Loading the meeting…</p>
      </section>
    );
  }

  const m = meeting.data;
  // The recorder's lines carry their name; "You" only while you haven't set one.
  const recorderName = m.recorder === me ? (nameOf(m.recorder) ?? "You") : displayName(m.recorder, null, nameOf(m.recorder));
  return (
    <MeetingBody
      workspace={workspace}
      meeting={m}
      recordingBlobs={workspace.blobs}
      segments={transcript.segments}
      more={transcript.next !== null}
      loadingMore={transcript.loading}
      transcriptError={transcript.error}
      onLoadMore={() => void transcript.loadMore()}
      onSegmentChanged={transcript.replace}
      actions={actions.data}
      insights={insights.data}
      me={me}
      isOwner={isOwner}
      recorderName={recorderName}
      onBack={onBack}
      focusSeq={focusSeq}
    />
  );
}

/** The meeting once read. Presentational apart from the calls it makes through `workspace.act`. */
export function MeetingBody({
  workspace,
  recordingBlobs,
  meeting: m,
  segments,
  more,
  loadingMore,
  transcriptError,
  onLoadMore,
  onSegmentChanged,
  actions,
  insights = null,
  me,
  isOwner,
  recorderName,
  onBack,
  focusSeq,
}: {
  workspace: Pick<Workspace, "act">;
  /** Where the recording is read from; without it there is no player. */
  recordingBlobs?: Workspace["blobs"];
  meeting: MeetingView;
  segments: SegmentView[];
  more: boolean;
  loadingMore: boolean;
  transcriptError: string | null;
  onLoadMore: () => void;
  onSegmentChanged: (s: SegmentView) => void;
  actions: import("./sylenceApi").ActionView[] | null;
  /** What was worked out about each person, if anyone ran Analyze. */
  insights?: Insights | null;
  me: string;
  isOwner: boolean;
  recorderName: string;
  onBack: () => void;
  focusSeq?: number;
}) {
  const recorder = m.recorder === me;
  const canEdit = recorder || isOwner;
  const [find, setFind] = useState("");
  const findWords = useMemo(() => queryWords(find), [find]);
  /** The speaker the transcript is narrowed to, or null for everyone. */
  const [who, setWho] = useState<string | null>(null);
  const speakers = useMemo(() => speakersIn(segments, recorderName), [segments, recorderName]);
  // Names given to speaker labels ("Speaker 1" → "Eve").
  const aliases = useMemo(() => new Map((m.speakerNames ?? []).map((a) => [a.label, a.name])), [m.speakerNames]);
  const nameOf = useCallback((label: string) => aliases.get(label) ?? label, [aliases]);
  const labelOf = useCallback((s: SegmentView) => speakerLabel(s.speaker, recorderName, s.name), [recorderName]);
  const stats = useMemo(() => talkStats(segments, labelOf), [segments, labelOf]);
  const colorOf = useMemo(() => {
    const index = new Map(stats.speakers.map((s, i) => [s.label, i]));
    return (label: string) => speakerColor(index.get(label) ?? 7);
  }, [stats]);
  const shownSegments = useMemo(
    () =>
      segments.filter(
        (s) => (!findWords.length || matchesAll(s.text, findWords)) && (who === null || labelOf(s) === who),
      ),
    [segments, findWords, who, labelOf],
  );

  const analyze = useAnalyze({ workspace, meetingId: m.id, segments, labelOf, stats });

  // ── playback ──
  const noBlobs = useMemo(() => ({ upload: () => Promise.reject(new Error("no workspace")), download: () => Promise.reject(new Error("no workspace")) }), []);
  const recording = useRecording(recordingBlobs ?? noBlobs, recordingBlobs ? m.audio : null);
  const hasAudio = !!m.audio && !!recordingBlobs;
  const player = usePlayer();
  const [follow, setFollow] = useState(true);
  const byStart = useMemo(() => [...segments].sort((a, b) => a.startMs - b.startMs || a.seq - b.seq), [segments]);
  const playingIndex = hasAudio ? activeIndex(byStart, player.timeMs) : -1;
  const playingSeq = playingIndex >= 0 ? byStart[playingIndex]!.seq : null;
  const lanes = useMemo(
    () => (hasAudio ? speakerLanes(segments, labelOf, stats.speakers.map((s) => s.label), m.audio?.durationMs || m.durationMs) : []),
    [hasAudio, segments, labelOf, stats, m.audio?.durationMs, m.durationMs],
  );
  const playingRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (follow && player.playing && playingSeq !== null) playingRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [follow, player.playing, playingSeq]);
  const seekTo = useCallback(
    (ms: number, play = true) => {
      player.seek(ms, play);
    },
    [player],
  );
  const lastSeq = segments.length ? segments[segments.length - 1]!.seq : -1;
  // Finding reads the whole transcript; a linked line reads up to it.
  const wantsMore = more && !loadingMore && (findWords.length > 0 || (focusSeq !== undefined && focusSeq > lastSeq));
  useEffect(() => {
    if (wantsMore) onLoadMore();
  }, [wantsMore, onLoadMore]);
  const focusedRef = useRef<HTMLLIElement | null>(null);
  const focusLoaded = focusSeq !== undefined && segments.some((s) => s.seq === focusSeq);
  useEffect(() => {
    if (focusLoaded) focusedRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusLoaded]);
  // A linked line (a search hit) is where playback starts.
  const focusStart = focusLoaded ? segments.find((s) => s.seq === focusSeq)?.startMs : undefined;
  const { seek } = player;
  useEffect(() => {
    if (recording.url && focusStart !== undefined) seek(focusStart);
  }, [recording.url, focusStart, seek]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const segmentStart = useCallback((seq: number) => segments.find((s) => s.seq === seq)?.startMs, [segments]);

  const markdown = useMemo(
    () => toMarkdown(m, segments, actions ?? [], recorderName, undefined, nameOf),
    [m, segments, actions, recorderName, nameOf],
  );

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_600);
    } catch {
      setError("Your browser did not let the page copy. Use Download instead.");
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = markdownFileName(m.title);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="meeting-page">
      <header className="meeting-head card">
        <BackButton onBack={onBack} />
        <div className="meeting-head-main">
          <PlatformMark platform={m.platform} size={44} />
          <div className="meeting-head-text">
            <Title meeting={m} editable={recorder} onRename={(title) => run(() => workspace.act((c) => c.renameMeeting({ meetingId: m.id, title })))} />
            <p className="meeting-meta">
              {m.live && <LiveBadge />}
              <span>{formatWhen(m.startedAt)}</span>
              <span className="dot" aria-hidden="true" />
              <span>{platformName(m.platform)}</span>
              <span className="dot" aria-hidden="true" />
              <span>
                {m.platform === "upload" ? "Uploaded by" : "Recorded by"} <PersonName account={m.recorder} />
              </span>
            </p>
            <p className="meeting-stats inline">
              <span>
                <Clock size={14} aria-hidden="true" /> {m.durationMs ? formatDuration(m.durationMs) : "—"}
              </span>
              <span>
                <FileText size={14} aria-hidden="true" /> {m.words.toLocaleString()} words
              </span>
              <span>
                <CheckSquare size={14} aria-hidden="true" /> {m.openActions} open
              </span>
            </p>
          </div>
        </div>
        <div className="meeting-tools">
          <button type="button" className="btn" onClick={() => void copy()}>
            <Icon name={copied ? "check" : "copy"} /> {copied ? "Copied" : "Copy as Markdown"}
          </button>
          <button type="button" className="btn" onClick={download}>
            <Download size={16} aria-hidden="true" /> Download .md
          </button>
          {(recorder || isOwner) && <DeleteMeeting workspace={workspace} meetingId={m.id} onDeleted={onBack} />}
        </div>
      </header>

      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}

      {hasAudio && (
        <Player
          player={player}
          src={recording.url}
          loading={recording.loading}
          error={recording.error}
          fallbackDurationMs={m.audio?.durationMs || m.durationMs}
          lanes={lanes}
          nameOf={nameOf}
          follow={follow}
          onFollow={setFollow}
        />
      )}

      <Summary
        summary={m.summary}
        editable={recorder}
        onSave={(summary) => run(() => workspace.act((c) => c.setSummary({ meetingId: m.id, summary })))}
      />

      {!m.live && segments.length > 0 && (
        <PeopleCard
          insights={insights}
          stats={stats}
          actions={actions}
          displayName={nameOf}
          canAnalyze={canEdit}
          analyze={analyze}
          onSeek={hasAudio && recording.url ? (ms) => seekTo(ms) : undefined}
        />
      )}

      <div className="meeting-grid">
        <section className="card transcript-card" aria-labelledby="transcript-title">
          <div className="card-head">
            <h2 id="transcript-title">Transcript</h2>
            <span className="dim" data-testid="line-count">
              {findWords.length || who !== null
                ? `${shownSegments.length.toLocaleString()} of ${m.segments.toLocaleString()} lines`
                : `${m.segments.toLocaleString()} lines`}
            </span>
            <div className="search find">
              <Icon name="search" size={14} />
              <input
                type="search"
                aria-label="Find in transcript"
                placeholder="Find in transcript"
                value={find}
                onChange={(e) => setFind(e.target.value)}
                onKeyDown={(e) => {
                  // Enter plays from the first line found.
                  if (e.key === "Enter" && hasAudio && findWords.length && shownSegments[0]) seekTo(shownSegments[0].startMs);
                }}
              />
            </div>
          </div>
          {speakers.length > 1 && (
            <div className="speaker-filter" role="group" aria-label="Speakers">
              <button type="button" className={`chip${who === null ? " active" : ""}`} aria-pressed={who === null} onClick={() => setWho(null)}>
                Everyone
              </button>
              {speakers.map((sp) => (
                <button
                  type="button"
                  key={sp.label}
                  className={`chip${who === sp.label ? " active" : ""}`}
                  aria-pressed={who === sp.label}
                  onClick={() => setWho(who === sp.label ? null : sp.label)}
                >
                  {nameOf(sp.label)}
                  <span className="chip-count">{sp.lines.toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
          {findWords.length > 0 && shownSegments.length === 0 && !loadingMore && (
            <p className="empty">No line contains &ldquo;{find.trim()}&rdquo;.</p>
          )}
          {segments.length === 0 && !loadingMore && (
            <p className="empty">{m.live ? "Listening… the first lines appear here in a few seconds." : "No transcript was saved for this meeting."}</p>
          )}
          <ol className="transcript" aria-live={m.live ? "polite" : undefined}>
            {shownSegments.map((s) => (
              <SegmentRow
                key={s.seq}
                ref={s.seq === focusSeq ? focusedRef : s.seq === playingSeq ? playingRef : undefined}
                focused={s.seq === focusSeq}
                playing={s.seq === playingSeq}
                onSeek={hasAudio && recording.url ? () => seekTo(s.startMs) : undefined}
                color={colorOf(labelOf(s))}
                highlight={findWords}
                segment={s}
                speaker={nameOf(labelOf(s))}
                editable={recorder}
                onSave={(text) =>
                  run(async () => {
                    const updated = await workspace.act((c) => c.editSegment({ meetingId: m.id, seq: s.seq, text }));
                    onSegmentChanged(updated);
                  })
                }
                onMakeAction={() =>
                  run(() =>
                    workspace.act((c) =>
                      c.addAction({ meetingId: m.id, text: s.text.slice(0, 500), assignee: "", sourceSeq: s.seq }),
                    ),
                  )
                }
              />
            ))}
          </ol>
          {transcriptError && <p className="err">{transcriptError}</p>}
          {more && (
            <button type="button" className="btn ghost load-more" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </section>

        <div className="side">
          <SpeakersCard
            stats={stats}
            nameOf={nameOf}
            canRename={canEdit}
            onRename={(label, name) => run(() => workspace.act((c) => c.setSpeakerName({ meetingId: m.id, label, name })))}
            onSeek={hasAudio && recording.url ? (ms) => seekTo(ms) : undefined}
          />
          <ActionItems
            workspace={workspace}
            meetingId={m.id}
            actions={actions}
            me={me}
            recorder={m.recorder}
            isOwner={isOwner}
            segmentStart={segmentStart}
          />
          <details className="card details">
            <summary>Details</summary>
            <dl>
              <dt>Speech model</dt>
              <dd>{m.revised ? "whisper-large-v3-turbo, after the call" : m.model || "—"}</dd>
              <dt>Language</dt>
              <dd>{m.language || "Detected"}</dd>
              {m.url && (
                <>
                  <dt>Call link</dt>
                  <dd className="mono wrap-anywhere">{m.url}</dd>
                </>
              )}
              <dt>Meeting id</dt>
              <dd className="mono">{m.id}</dd>
              <dt>Recorder</dt>
              <dd className="mono wrap-anywhere">{m.recorder}</dd>
            </dl>
          </details>
        </div>
      </div>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="btn ghost back" onClick={onBack}>
      <Icon name="left" /> All meetings
    </button>
  );
}

function Title({
  meeting,
  editable,
  onRename,
}: {
  meeting: MeetingView;
  editable: boolean;
  onRename: (title: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null) {
    return (
      <form
        className="title-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          void onRename(draft.trim()).then(() => setDraft(null));
        }}
      >
        <input
          aria-label="Meeting title"
          autoFocus
          maxLength={200}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
        />
        <button type="submit" className="btn small primary">
          Save
        </button>
      </form>
    );
  }
  return (
    <h1 className="meeting-h1">
      {meeting.title}
      {editable && (
        <button type="button" className="icon-btn" aria-label="Rename meeting" onClick={() => setDraft(meeting.title)}>
          <Icon name="pen" size={14} />
        </button>
      )}
    </h1>
  );
}

function Summary({ summary, editable, onSave }: { summary: string; editable: boolean; onSave: (s: string) => Promise<unknown> }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (!summary && !editable) return null;
  return (
    <section className="card summary-card" aria-labelledby="summary-title">
      <div className="card-head">
        <h2 id="summary-title">Summary</h2>
        {editable && draft === null && (
          <button type="button" className="btn small ghost" onClick={() => setDraft(summary)}>
            <Icon name="pen" size={14} /> {summary ? "Edit" : "Write one"}
          </button>
        )}
      </div>
      {draft !== null ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSave(draft).then(() => setDraft(null));
          }}
        >
          <textarea
            aria-label="Summary"
            autoFocus
            rows={5}
            maxLength={20_000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="row end">
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
              Save summary
            </button>
          </div>
        </form>
      ) : summary ? (
        <p className="summary-text">{summary}</p>
      ) : (
        <p className="empty">No summary yet. Write a few lines for the people who missed the call.</p>
      )}
    </section>
  );
}

function SegmentRow({
  ref,
  focused = false,
  playing = false,
  onSeek,
  color,
  highlight = [],
  segment,
  speaker,
  editable,
  onSave,
  onMakeAction,
}: {
  ref?: React.Ref<HTMLLIElement>;
  focused?: boolean;
  /** The line being said in the recording now. */
  playing?: boolean;
  /** Play the recording from this line. */
  onSeek?: () => void;
  color?: string;
  highlight?: readonly string[];
  segment: SegmentView;
  speaker: string;
  editable: boolean;
  onSave: (text: string) => Promise<unknown>;
  onMakeAction: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [made, setMade] = useState(false);
  useEffect(() => {
    if (!made) return;
    const t = setTimeout(() => setMade(false), 1_600);
    return () => clearTimeout(t);
  }, [made]);
  return (
    <li
      ref={ref}
      id={`line-${segment.seq}`}
      className={`segment speaker-${segment.speaker === "you" ? "you" : "others"}${focused ? " focused" : ""}${playing ? " playing" : ""}`}
      data-testid="segment"
      aria-current={playing ? "true" : undefined}
    >
      {onSeek ? (
        <button type="button" className="segment-time seekable mono" onClick={onSeek} aria-label={`Play from ${formatClock(segment.startMs)}`}>
          {formatClock(segment.startMs)}
        </button>
      ) : (
        <span className="segment-time mono">{formatClock(segment.startMs)}</span>
      )}
      <span className={`speaker-chip ${segment.speaker === "you" ? "you" : "others"}`} title={speaker}>
        {color && <span className="spk-dot" style={{ background: color }} aria-hidden="true" />}
        {speaker}
      </span>
      {draft !== null ? (
        <form
          className="segment-edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            void onSave(draft.trim()).then(() => setDraft(null));
          }}
        >
          <textarea
            aria-label="Segment text"
            autoFocus
            rows={2}
            maxLength={4_000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
          />
          <div className="row end">
            <button type="button" className="btn small ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="submit" className="btn small primary">
              Save
            </button>
          </div>
        </form>
      ) : (
        <p className="segment-text">
          {highlightParts(segment.text, highlight).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
          {segment.edited && <span className="edited"> (edited)</span>}
        </p>
      )}
      {draft === null && (
        <span className="row-tools">
          <button
            type="button"
            className="icon-btn"
            aria-label="Make action item"
            title="Make action item"
            onClick={() => void onMakeAction().then(() => setMade(true))}
          >
            <Icon name={made ? "check" : "plus"} size={14} />
          </button>
          {editable && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Edit line"
              title="Correct this line"
              onClick={() => setDraft(segment.text)}
            >
              <Icon name="pen" size={14} />
            </button>
          )}
        </span>
      )}
    </li>
  );
}

function DeleteMeeting({
  workspace,
  meetingId,
  onDeleted,
}: {
  workspace: Pick<Workspace, "act">;
  meetingId: string;
  onDeleted: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!asking) {
    return (
      <button type="button" className="btn danger-ghost" onClick={() => setAsking(true)}>
        <Trash size={16} aria-hidden="true" /> Delete
      </button>
    );
  }
  const deleting = remaining !== null;
  return (
    <div className="confirm" role="group" aria-label="Delete this meeting">
      <span>{deleting ? (remaining ? `Deleting… ${remaining.toLocaleString()} lines left` : "Deleting…") : "Delete the meeting, its transcript and action items?"}</span>
      <button type="button" className="btn ghost" disabled={deleting} onClick={() => setAsking(false)}>
        Cancel
      </button>
      <button
        type="button"
        className="btn danger"
        disabled={deleting}
        onClick={() => {
          setRemaining(0);
          setError(null);
          workspace
            .act((c) => deleteMeetingFully(c, meetingId, setRemaining))
            .then(onDeleted)
            .catch((e: unknown) => {
              setRemaining(null);
              setError(e instanceof Error ? e.message : String(e));
            });
        }}
      >
        Delete for everyone
      </button>
      {error && <span className="err">{error}</span>}
    </div>
  );
}
