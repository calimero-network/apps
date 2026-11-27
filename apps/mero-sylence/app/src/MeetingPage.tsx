import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
  highlighter,
  markdownFileName,
  matchesAll,
  recordingFileName,
  platformName,
  queryWords,
  keyName,
  speakerKey,
  toMarkdown,
} from "./lib/transcript";
import { useTranscript } from "./useTranscript";
import type { Highlighter } from "./lib/transcript";
import { useRead, type Workspace } from "./useWorkspace";
import { Icon } from "./ui";
import { talkStats } from "./lib/stats";
import { speakerColor, speakerLanes } from "./lib/playback";
import { AssigneePicker, useMemberNames } from "./Assignee";
import { inPopover, Popover } from "./Popover";
import { usePresence } from "./usePresence";
import { assignables, type Assignable } from "./lib/assignee";
import { Player } from "./Player";
import { usePlayer, usePlayingIndex } from "./usePlayer";
import { SpeakersCard } from "./SpeakersCard";
import { forgetRecording, recordingBlob, useRecording } from "./useRecording";
import { PeopleCard } from "./PeopleCard";
import { useAnalyze } from "./useAnalyze";
import { MeetingSkeleton, TranscriptSkeleton } from "./Skeletons";
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
  // Insights change rarely: read them once, then on their own event only.
  const [insightsVersion, setInsightsVersion] = useState(0);
  const { subscribe } = workspace;
  useEffect(
    () =>
      subscribe((event) => {
        if (event.kind === "InsightsChanged" && event.data.meetingId === meetingId) setInsightsVersion((v) => v + 1);
      }),
    [subscribe, meetingId],
  );
  const insights = useRead(workspace.client, insightsVersion, (c) => c.insights({ meetingId }), [meetingId]);
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
  if (!meeting.data) return <MeetingSkeleton />;

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
      onLoadMore={transcript.loadMore}
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

/** Hands `blob` to the browser as a download named `name`. */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Long enough for the browser to start reading it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Whichever insights were saved last: a run here, or the latest read. */
function newer(a: Insights | null, b: Insights | null): Insights | null {
  if (!a || !b) return a ?? b;
  return Number(a.updatedAt) >= Number(b.updatedAt) ? a : b;
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
  onLoadMore: () => unknown;
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
  // Typing stays quick on a long transcript: the list follows a beat behind.
  const deferredFind = useDeferredValue(find);
  const findWords = useMemo(() => queryWords(deferredFind), [deferredFind]);
  const mark = useMemo(() => highlighter(findWords), [findWords]);
  /** The speaker key the transcript is narrowed to, or null for everyone. */
  const [who, setWho] = useState<string | null>(null);
  // Names given to speakers ("Speaker 1" → "Eve"), by stable key; a re-read with the same names keeps the memo.
  const aliasesJson = JSON.stringify(m.speakerNames ?? []);
  const aliases = useMemo(
    () => new Map((JSON.parse(aliasesJson) as { label: string; name: string }[]).map((a) => [a.label, a.name])),
    [aliasesJson],
  );
  const nameOf = useCallback((key: string) => keyName(key, recorderName, aliases), [recorderName, aliases]);
  const labelOf = useCallback((s: SegmentView) => speakerKey(s.speaker, s.name), []);
  const stats = useMemo(() => talkStats(segments, labelOf), [segments, labelOf]);
  /** Speakers in the order they first spoke, with their line counts, for the filter. */
  const speakers = useMemo(
    () => [...stats.speakers].sort((a, b) => a.firstMs - b.firstMs).map((s) => ({ label: s.label, lines: s.lines })),
    [stats],
  );
  const colorOf = useMemo(() => {
    const index = new Map(stats.speakers.map((s, i) => [s.label, i]));
    return (label: string) => speakerColor(index.get(label) ?? 7);
  }, [stats]);
  /** The call's speakers as action items name them, in their transcript colour. */
  const actionSpeakers = useMemo(
    // An unnamed "Others" is no one to give work to.
    () => speakers.filter((s) => s.label !== "others").map((s) => ({ name: nameOf(s.label), color: colorOf(s.label) })),
    [speakers, nameOf, colorOf],
  );
  const memberNames = useMemberNames();
  const actionPeople = useMemo(() => assignables(actionSpeakers, memberNames), [actionSpeakers, memberNames]);
  const shownSegments = useMemo(
    () =>
      segments.filter(
        (s) => (!findWords.length || matchesAll(s.text, findWords)) && (who === null || labelOf(s) === who),
      ),
    [segments, findWords, who, labelOf],
  );

  const analyze = useAnalyze({ workspace, meetingId: m.id, segments, labelOf, stats });

  // ── playback ──
  const noBlobs = useMemo(() => ({ appId: "", upload: () => Promise.reject(new Error("no workspace")), download: () => Promise.reject(new Error("no workspace")) }), []);
  const recording = useRecording(recordingBlobs ?? noBlobs, recordingBlobs ? m.audio : null);
  const hasAudio = !!m.audio && !!recordingBlobs;
  const player = usePlayer();
  const [follow, setFollow] = useState(true);
  const byStart = useMemo(() => [...segments].sort((a, b) => a.startMs - b.startMs || a.seq - b.seq), [segments]);
  const playingIndex = usePlayingIndex(player, byStart, hasAudio && player.engaged);
  const playingSeq = playingIndex >= 0 ? (byStart[playingIndex]?.seq ?? null) : null;
  const lanes = useMemo(
    () => (hasAudio ? speakerLanes(segments, labelOf, stats.speakers.map((s) => s.label), m.audio?.durationMs || m.durationMs) : []),
    [hasAudio, segments, labelOf, stats, m.audio?.durationMs, m.durationMs],
  );
  const playingRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (follow && player.playing && playingSeq !== null) playingRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [follow, player.playing, playingSeq]);
  const { seek } = player;
  const seekTo = useCallback((ms: number) => seek(ms, true), [seek]);
  const lastSeq = segments.length ? segments[segments.length - 1]!.seq : -1;
  // An ended meeting is read whole: talk time, the timeline, playback and Analyze cover every line.
  // While live, finding reads the whole transcript and a linked line reads up to it.
  // A failed read waits for "Load more" instead of being retried in a loop.
  const wantsMore =
    more &&
    !loadingMore &&
    !transcriptError &&
    (!m.live || findWords.length > 0 || (focusSeq !== undefined && focusSeq > lastSeq));
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
  useEffect(() => {
    if (recording.url && focusStart !== undefined) seek(focusStart);
  }, [recording.url, focusStart, seek]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savingAudio, setSavingAudio] = useState(false);
  const segmentStart = useCallback((seq: number) => segments.find((s) => s.seq === seq)?.startMs, [segments]);

  // Built when asked for, not on every render.
  const markdown = () => toMarkdown(m, segments, actions ?? [], recorderName, undefined, (s) => nameOf(labelOf(s)));

  /** Runs a write; false (and the error shown) when it failed. */
  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, []);
  const { act } = workspace;
  const meetingId = m.id;
  const saveLine = useCallback(
    (seq: number, text: string) =>
      run(async () => {
        const updated = await act((c) => c.editSegment({ meetingId, seq, text }));
        onSegmentChanged(updated);
      }),
    [run, act, meetingId, onSegmentChanged],
  );
  const makeAction = useCallback(
    (s: SegmentView, assignee: string) =>
      run(() => act((c) => c.addAction({ meetingId, text: s.text.slice(0, 500), assignee: assignee.trim(), sourceSeq: s.seq }))),
    [run, act, meetingId],
  );
  const canSeek = hasAudio && !!recording.url;
  // The playing line and the linked line may be the same row: one ref callback sets both.
  const rowRef = useCallback(
    (seq: number) => (el: HTMLLIElement | null) => {
      if (seq === focusSeq) focusedRef.current = el;
      if (seq === playingSeq) playingRef.current = el;
    },
    [focusSeq, playingSeq],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown());
      setCopied(true);
      setTimeout(() => setCopied(false), 1_600);
    } catch {
      setError("Your browser did not let the page copy. Use Download instead.");
    }
  };

  const download = () => saveFile(new Blob([markdown()], { type: "text/markdown" }), markdownFileName(m.title));

  /** Saves the recording itself, read the way the player reads it. */
  const downloadRecording = async () => {
    if (!m.audio || !recordingBlobs) return;
    setSavingAudio(true);
    setError(null);
    try {
      const blob = await recordingBlob(recordingBlobs, m.audio);
      saveFile(blob, recordingFileName(m.title, m.audio.mime));
    } catch (e) {
      setError(`The recording did not download: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingAudio(false);
    }
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
          <ExportMenu
            copied={copied}
            busy={savingAudio}
            hasAudio={hasAudio}
            onCopy={() => void copy()}
            onDownloadMarkdown={download}
            onDownloadRecording={() => void downloadRecording()}
          />
          {(recorder || isOwner) && (
            <DeleteMeeting
              workspace={workspace}
              meetingId={m.id}
              onDeleted={() => {
                // The recording kept in this browser goes with the meeting.
                if (m.audio && recordingBlobs) void forgetRecording(recordingBlobs.appId, m.audio.blob);
                onBack();
              }}
            />
          )}
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
          insights={newer(analyze.saved, insights)}
          stats={stats}
          actions={actions}
          displayName={nameOf}
          canAnalyze={canEdit && !more}
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
          {segments.length === 0 && loadingMore && <TranscriptSkeleton />}
          {segments.length === 0 && !loadingMore && (
            <p className="empty">{m.live ? "Listening… the first lines appear here in a few seconds." : "No transcript was saved for this meeting."}</p>
          )}
          <ol className="transcript" aria-live={m.live ? "polite" : undefined}>
            {shownSegments.map((s) => (
              <SegmentRow
                key={s.seq}
                ref={s.seq === focusSeq || s.seq === playingSeq ? rowRef(s.seq) : undefined}
                focused={s.seq === focusSeq}
                playing={s.seq === playingSeq}
                onSeek={canSeek ? seekTo : undefined}
                color={colorOf(labelOf(s))}
                mark={mark}
                segment={s}
                speaker={nameOf(labelOf(s))}
                editable={recorder}
                onSave={saveLine}
                onMakeAction={makeAction}
                people={actionPeople}
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
            speakers={actionSpeakers}
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

const SegmentRow = memo(function SegmentRow({
  ref,
  focused = false,
  playing = false,
  onSeek,
  color,
  mark,
  segment,
  speaker,
  editable,
  onSave,
  onMakeAction,
  people = [],
}: {
  ref?: React.Ref<HTMLLIElement>;
  focused?: boolean;
  /** The line being said in the recording now. */
  playing?: boolean;
  /** Play the recording from a time (this line's start). */
  onSeek?: (ms: number) => void;
  color?: string;
  /** Cuts the text into plain and found parts. */
  mark: Highlighter;
  segment: SegmentView;
  speaker: string;
  editable: boolean;
  onSave: (seq: number, text: string) => Promise<unknown>;
  onMakeAction: (segment: SegmentView, assignee: string) => Promise<unknown>;
  /** Who the action item can be given to; the line's speaker comes first. */
  people?: readonly Assignable[];
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [made, setMade] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const picker = usePresence(assigning);
  const toolsRef = useRef<HTMLSpanElement>(null);
  const makeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!assigning) return;
    const close = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node) && !inPopover(e.target)) setAssigning(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAssigning(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [assigning]);
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
        <button type="button" className="segment-time seekable mono" onClick={() => onSeek(segment.startMs)} aria-label={`Play from ${formatClock(segment.startMs)}`}>
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
            void onSave(segment.seq, draft.trim()).then(() => setDraft(null));
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
          {mark(segment.text).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
          {segment.edited && <span className="edited"> (edited)</span>}
        </p>
      )}
      {draft === null && (
        <span className={`row-tools${assigning ? " pinned" : ""}`} ref={toolsRef}>
          <span className="who-wrap">
            <button
              ref={makeRef}
              type="button"
              className="icon-btn"
              aria-label="Make action item"
              aria-expanded={assigning}
              title="Make action item, and say who does it"
              onClick={() => setAssigning((o) => !o)}
            >
              <Icon name={made ? "check" : "plus"} size={14} />
            </button>
            {picker.mounted && (
              <Popover anchor={makeRef.current} closing={picker.closing} width={248} label="Who does it">
                <AssigneePicker
                  current=""
                  people={people}
                  first={speaker}
                  noneLabel="Add without assigning"
                  onPick={(who) => {
                    setAssigning(false);
                    void onMakeAction(segment, who).then(() => setMade(true));
                  }}
                />
              </Popover>
            )}
          </span>
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
});

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

/** "Export": copy the meeting as Markdown, download it as .md, or download its recording. */
function ExportMenu({
  copied,
  busy,
  hasAudio,
  onCopy,
  onDownloadMarkdown,
  onDownloadRecording,
}: {
  copied: boolean;
  busy: boolean;
  hasAudio: boolean;
  onCopy: () => void;
  onDownloadMarkdown: () => void;
  onDownloadRecording: () => void;
}) {
  const [open, setOpen] = useState(false);
  const presence = usePresence(open);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!button.current?.contains(e.target as Node) && !inPopover(e.target)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`btn export-button${busy ? " is-busy" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy}
        onClick={() => setOpen((o) => !o)}
        data-testid="export-menu"
      >
        {busy ? <span className="btn-spinner" aria-hidden="true" /> : copied ? <Icon name="check" /> : <Download size={16} aria-hidden="true" />}
        {busy ? "Preparing…" : copied ? "Copied" : "Export"}
        <Icon name="down" size={14} />
      </button>
      {presence.mounted && (
        <Popover anchor={button.current} closing={presence.closing} width={220} role="menu" label="Export">
          <div className="menu-panel-in">
            <button type="button" role="menuitem" className="menu-item" onClick={pick(onCopy)}>
              <Icon name="copy" /> Copy as Markdown
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={pick(onDownloadMarkdown)}>
              <Icon name="form" /> Download .md
            </button>
            {hasAudio && (
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                disabled={busy}
                onClick={pick(onDownloadRecording)}
                data-testid="download-recording"
              >
                <Icon name="wave" /> Download recording
              </button>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}
