import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare, Clock, Download, FileText, Trash } from "@calimero-network/mero-icons";
import type { MeetingView, SegmentView } from "./minutesApi";
import { deleteMeetingFully } from "./minutesApi";
import { ActionItems } from "./ActionItems";
import { LiveBadge } from "./MeetingsList";
import { PlatformMark } from "./PlatformMark";
import { PersonName, useSpaceNames } from "./names";
import { displayName } from "./lib/people";
import {
  formatClock,
  formatDuration,
  formatWhen,
  markdownFileName,
  platformName,
  speakerLabel,
  toMarkdown,
} from "./lib/transcript";
import { useTranscript } from "./useTranscript";
import { useRead, type Workspace } from "./useWorkspace";
import { Icon } from "./ui";

/** One meeting: its header, summary, transcript (live while recording) and action items. */
export function MeetingPage({
  workspace,
  meetingId,
  me,
  isOwner,
  onBack,
}: {
  workspace: Workspace;
  meetingId: string;
  me: string;
  /** The signed-in account owns the workspace: it may delete any meeting. */
  isOwner: boolean;
  onBack: () => void;
}) {
  const meeting = useRead(workspace.client, workspace.version, (c) => c.getMeeting({ meetingId }), [meetingId]);
  const actions = useRead(workspace.client, workspace.version, (c) => c.listActions({ meetingId }), [meetingId]);
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
  const recorderName = m.recorder === me ? "You" : displayName(m.recorder, null, nameOf(m.recorder));
  return (
    <MeetingBody
      workspace={workspace}
      meeting={m}
      segments={transcript.segments}
      more={transcript.next !== null}
      loadingMore={transcript.loading}
      transcriptError={transcript.error}
      onLoadMore={() => void transcript.loadMore()}
      onSegmentChanged={transcript.replace}
      actions={actions.data}
      me={me}
      isOwner={isOwner}
      recorderName={recorderName}
      onBack={onBack}
    />
  );
}

/** The meeting once read. Presentational apart from the calls it makes through `workspace.act`. */
export function MeetingBody({
  workspace,
  meeting: m,
  segments,
  more,
  loadingMore,
  transcriptError,
  onLoadMore,
  onSegmentChanged,
  actions,
  me,
  isOwner,
  recorderName,
  onBack,
}: {
  workspace: Pick<Workspace, "act">;
  meeting: MeetingView;
  segments: SegmentView[];
  more: boolean;
  loadingMore: boolean;
  transcriptError: string | null;
  onLoadMore: () => void;
  onSegmentChanged: (s: SegmentView) => void;
  actions: import("./minutesApi").ActionView[] | null;
  me: string;
  isOwner: boolean;
  recorderName: string;
  onBack: () => void;
}) {
  const recorder = m.recorder === me;
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const segmentStart = useCallback((seq: number) => segments.find((s) => s.seq === seq)?.startMs, [segments]);

  const markdown = useMemo(
    () => toMarkdown(m, segments, actions ?? [], recorderName, undefined),
    [m, segments, actions, recorderName],
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
                Recorded by <PersonName account={m.recorder} />
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

      <Summary
        summary={m.summary}
        editable={recorder}
        onSave={(summary) => run(() => workspace.act((c) => c.setSummary({ meetingId: m.id, summary })))}
      />

      <div className="meeting-grid">
        <section className="card transcript-card" aria-labelledby="transcript-title">
          <div className="card-head">
            <h2 id="transcript-title">Transcript</h2>
            <span className="dim">{m.segments.toLocaleString()} lines</span>
          </div>
          {segments.length === 0 && !loadingMore && (
            <p className="empty">{m.live ? "Listening… the first lines appear here in a few seconds." : "No transcript was saved for this meeting."}</p>
          )}
          <ol className="transcript" aria-live={m.live ? "polite" : undefined}>
            {segments.map((s) => (
              <SegmentRow
                key={s.seq}
                segment={s}
                speaker={speakerLabel(s.speaker, recorderName)}
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
              <dd>{m.model || "—"}</dd>
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
  segment,
  speaker,
  editable,
  onSave,
  onMakeAction,
}: {
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
    <li className={`segment speaker-${segment.speaker === "you" ? "you" : "others"}`} data-testid="segment">
      <span className="segment-time mono">{formatClock(segment.startMs)}</span>
      <span className={`speaker-chip ${segment.speaker === "you" ? "you" : "others"}`}>{speaker}</span>
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
          {segment.text}
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
