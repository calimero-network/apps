import { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "@calimero-network/mero-icons";
import { LANGUAGES } from "../../extension/src/lib/tiers";
import { findActions } from "../../extension/src/lib/actionItems";
import type { FromSpeech, SpeechStage, ToSpeech } from "./ai/speechProtocol";
import {
  ACCEPT,
  assignSpeakers,
  audioMime,
  batches,
  decodeTo16kMono,
  probeDuration,
  formatBytes,
  MAX_AUDIO_BYTES,
  isAudioFile,
  labelSpeakers,
  MAX_DURATION_MS,
  MAX_UNPROBED_BYTES,
  unkeptType,
  titleFromFile,
  toSegmentInputs,
  tooLargeForAudio,
} from "./lib/upload";
import { Icon } from "./ui";
import { rememberRecording } from "./useRecording";
import type { Workspace } from "./useWorkspace";
import "./upload.css";

type StepId = "decode" | "load" | "transcribe" | "voices" | "diarize" | "save" | "actions";

const STEPS: { id: StepId; label: string }[] = [
  { id: "decode", label: "Reading the recording" },
  { id: "load", label: "Loading the speech model" },
  { id: "transcribe", label: "Transcribing" },
  { id: "voices", label: "Loading the voice models" },
  { id: "diarize", label: "Telling voices apart" },
  { id: "save", label: "Saving to the workspace" },
  { id: "actions", label: "Finding action items" },
];

/** How much of the whole bar each step is. */
const WEIGHT: Record<StepId, number> = { decode: 0.04, load: 0.12, transcribe: 0.52, voices: 0.04, diarize: 0.16, save: 0.1, actions: 0.02 };

interface Run {
  step: StepId;
  fraction: number;
  /** A download's bytes so far and in all. */
  bytes?: { loaded: number; total: number };
}

/** `12.3 / 30.1 MB`. */
function formatDownload({ loaded, total }: { loaded: number; total: number }): string {
  const mb = (n: number) => (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0);
  return `${mb(loaded)} / ${mb(total)} MB`;
}

class Cancelled extends Error {}

function overall(run: Run): number {
  let done = 0;
  for (const s of STEPS) {
    if (s.id === run.step) return done + WEIGHT[s.id] * run.fraction;
    done += WEIGHT[s.id];
  }
  return done;
}

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

/**
 * Upload a recording: it is decoded and transcribed on this laptop, its
 * voices told apart, and it becomes a meeting (platform `upload`) with the
 * audio kept for playback when it fits in one blob.
 */
/** The speech worker as the dialog starts it; a test passes its own. */
export type SpeechWorkerFactory = () => Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror">;
const defaultSpeechWorker: SpeechWorkerFactory = () => new Worker(new URL("./ai/speech.worker.ts", import.meta.url), { type: "module" });

export function UploadRecording({
  workspace,
  onDone,
  onClose,
  createWorker = defaultSpeechWorker,
  decode = decodeTo16kMono,
  probe = probeDuration,
}: {
  workspace: Pick<Workspace, "act" | "blobs">;
  /** The meeting is saved; `note` says what did not go as asked (the audio not kept). */
  onDone: (meetingId: string, note?: string) => void;
  onClose: () => void;
  createWorker?: SpeechWorkerFactory;
  decode?: typeof decodeTo16kMono;
  probe?: typeof probeDuration;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("en");
  const [keepAudio, setKeepAudio] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** What is already in the workspace when something fails after the meeting started. */
  const [saved, setSaved] = useState<{ meetingId: string; note: string } | null>(null);
  const worker = useRef<ReturnType<SpeechWorkerFactory> | null>(null);
  /** Rejects the model run in flight, so a cancel ends `start`. */
  const stopRun = useRef<(() => void) | null>(null);
  /** The run that counts; a cancelled or replaced run sees a different number and stops. */
  const runId = useRef(0);
  /** The meeting the current run started, once it has. */
  const started = useRef<{ id: string; note: string; durationMs: number } | null>(null);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    }
    return () => {
      runId.current += 1;
      worker.current?.terminate();
      // A terminated worker answers nothing: settle the run waiting on it.
      stopRun.current?.();
      stopRun.current = null;
      // Closed mid-run (a workspace switch, signing out): a meeting already started is ended, not left live.
      const meeting = started.current;
      started.current = null;
      if (meeting) {
        void workspaceRef.current
          .act((c) => c.endMeeting({ meetingId: meeting.id, durationMs: meeting.durationMs }))
          .catch(() => undefined);
      }
    };
  }, []);

  const audioRefusal = file ? (unkeptType(file) ?? tooLargeForAudio(file.size)) : null;
  const busy = run !== null;

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    setError(null);
    setSaved(null);
    if (!isAudioFile(f)) {
      setError("That file is not a recording Sylence can read. Use mp3, m4a, wav, webm, ogg or mp4.");
      return;
    }
    setFile(f);
  };

  const close = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  /** A meeting that will not be finished is ended, so it does not stay live; best effort. */
  const settle = (meeting: { id: string; note: string; durationMs: number }, why: string) => {
    void workspace.act((c) => c.endMeeting({ meetingId: meeting.id, durationMs: meeting.durationMs })).catch(() => undefined);
    setSaved({
      meetingId: meeting.id,
      note: meeting.note ? `${meeting.note}; ${why}` : `The meeting was started, but its transcript was not fully saved; ${why}`,
    });
  };

  const cancel = () => {
    runId.current += 1;
    worker.current?.terminate();
    worker.current = null;
    stopRun.current?.();
    stopRun.current = null;
    setRun(null);
    const meeting = started.current;
    started.current = null;
    if (meeting) {
      settle(meeting, "the rest was cancelled.");
      setError(null);
    } else {
      setError("Cancelled. Nothing was saved.");
    }
  };

  const start = async () => {
    if (!file || saved) return;
    const me = ++runId.current;
    started.current = null;
    setError(null);
    const live = () => me === runId.current;
    const step = (id: StepId, fraction = 0) => {
      if (!live()) throw new Cancelled();
      setRun({ step: id, fraction });
    };
    try {
      step("decode");
      // The length first, from the file's header: a long file is refused before it is decoded.
      const probed = await probe(file);
      if (probed !== null && probed > MAX_DURATION_MS) throw new Error("Recordings up to 3 hours can be uploaded.");
      if (probed === null && file.size > MAX_UNPROBED_BYTES) {
        throw new Error("This browser cannot tell how long this recording is, and it is too large to read without knowing. Try an mp3 or m4a copy.");
      }
      step("decode", 0.2);
      const { audio, durationMs } = await decode(file);
      if (durationMs > MAX_DURATION_MS) throw new Error("Recordings up to 3 hours can be uploaded.");
      if (durationMs < 1_000) throw new Error("This recording is shorter than a second.");
      step("load");
      const webgpu = await hasWebGpu();
      step("load");

      const { chunks, turns, modelId } = await new Promise<{
        chunks: Extract<FromSpeech, { type: "done" }>["chunks"];
        turns: Extract<FromSpeech, { type: "done" }>["turns"];
        modelId: string;
      }>((resolve, reject) => {
        if (!live()) {
          reject(new Cancelled());
          return;
        }
        stopRun.current = () => reject(new Cancelled());
        const w = createWorker();
        worker.current = w;
        let modelId = "whisper";
        const stageStep: Record<SpeechStage, StepId> = { load: "load", transcribe: "transcribe", voices: "voices", diarize: "diarize" };
        w.onmessage = (e: MessageEvent<FromSpeech>) => {
          if (!live()) return;
          const m = e.data;
          if (m.type === "progress") setRun({ step: stageStep[m.stage], fraction: m.fraction, ...(m.bytes ? { bytes: m.bytes } : {}) });
          else if (m.type === "model") modelId = m.modelId;
          else if (m.type === "done") resolve({ chunks: m.chunks, turns: m.turns, modelId });
          else reject(new Error(m.error));
        };
        w.onerror = (e) => reject(new Error(e.message || "the speech model stopped"));
        const msg: ToSpeech = { type: "run", audio, language, webgpu };
        // The rendered buffer is the page's own: it moves to the worker, no copy.
        w.postMessage(msg, [audio.buffer]);
      });
      worker.current?.terminate();
      worker.current = null;
      stopRun.current = null;
      if (!live()) throw new Cancelled();

      const lines = labelSpeakers(assignSpeakers(chunks, turns));
      const segments = toSegmentInputs(lines);
      if (segments.length === 0) throw new Error("No speech was found in this recording.");

      step("save");
      const id = await workspace.act((c) =>
        c.startMeeting({ title: titleFromFile(file.name), platform: "upload", url: "", model: modelId, language }),
      );
      const meeting = { id, note: "", durationMs };
      if (!live()) {
        // Cancelled while the meeting was being started: it exists now, so end it.
        setError(null);
        settle(meeting, "the rest was cancelled.");
        return;
      }
      started.current = meeting;
      const parts = batches(segments, 100);
      for (let i = 0; i < parts.length; i++) {
        step("save", (0.7 * i) / parts.length);
        await workspace.act((c) => c.appendSegments({ meetingId: id, segments: parts[i]! }));
      }
      meeting.note = "The transcript is saved";
      const mime = audioMime(file);
      /** Why the audio was not kept, when keeping it was asked for and failed. */
      let audioNote: string | null = null;
      if (keepAudio && !audioRefusal && mime) {
        step("save", 0.75);
        try {
          // At the account's cap the upload would be refused after sending it all: ask first.
          const left = await workspace.act((c) => c.recordingsLeft());
          if (left === 0) throw new Error("you keep 100 recordings already; remove one to keep this one");
          const bytes = new Uint8Array(await file.arrayBuffer());
          step("save", 0.8);
          const { blobId } = await workspace.blobs.upload(bytes, mime);
          step("save", 0.9);
          await workspace.act((c) => c.attachAudio({ meetingId: id, blob: blobId, mime, durationMs }));
          // The uploader has the bytes already: keep them, so playback does not download them again.
          void rememberRecording(workspace.blobs.appId, blobId, file.slice(0, file.size, mime));
          meeting.note = "The transcript and the audio are saved";
        } catch (e) {
          if (e instanceof Cancelled || !live()) throw e;
          // The transcript is the point; a recording that could not be kept is noted, and the run goes on.
          audioNote = `The audio could not be kept: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      step("save", 0.95);
      await workspace.act((c) => c.endMeeting({ meetingId: id, durationMs }));

      step("actions");
      const found = findActions(segments.map((s) => ({ seq: s.seq, speaker: s.speaker, name: s.name, text: s.text })));
      for (let i = 0; i < found.length; i++) {
        step("actions", i / found.length);
        const a = found[i]!;
        await workspace.act((c) => c.addAction({ meetingId: id, text: a.text, assignee: a.assignee, sourceSeq: a.sourceSeq }));
      }
      if (!live()) return;
      started.current = null;
      setRun(null);
      if (audioNote) onDone(id, audioNote);
      else onDone(id);
    } catch (e) {
      if (!live() || e instanceof Cancelled) return;
      worker.current?.terminate();
      worker.current = null;
      stopRun.current = null;
      setRun(null);
      const meeting = started.current;
      started.current = null;
      if (meeting) settle(meeting, "the rest did not finish.");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const currentIndex = run ? STEPS.findIndex((s) => s.id === run.step) : -1;

  return (
    <dialog
      ref={ref}
      className="dialog upload-dialog"
      aria-labelledby="upload-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      data-testid="upload-dialog"
    >
      <div className="dialog-body">
        <div className="upload-head">
          <h2 id="upload-title">Upload a recording</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={close} disabled={busy}>
            <Icon name="x" />
          </button>
        </div>
        <p className="empty upload-lede">
          Transcribed on this laptop, with the voices told apart. The models download once and stay in the browser.
        </p>

        {!busy && (
          <>
            <label
              className={`upload-drop${dragging ? " dragging" : ""}${file ? " has-file" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files[0]);
              }}
            >
              <input
                type="file"
                accept={ACCEPT}
                className="visually-hidden"
                onChange={(e) => pick(e.target.files?.[0])}
                data-testid="upload-file"
              />
              <span className="upload-drop-icon" aria-hidden="true">
                {file ? <Icon name="wave" size={20} /> : <Upload size={20} />}
              </span>
              {file ? (
                <span className="upload-file">
                  <span className="upload-file-name">{file.name}</span>
                  <span className="dim">{formatBytes(file.size)} · choose another</span>
                </span>
              ) : (
                <span className="upload-file">
                  <span className="upload-file-name">Drop a recording here, or browse</span>
                  <span className="dim">mp3, m4a, wav, webm, ogg or mp4 · up to 3 hours</span>
                </span>
              )}
            </label>

            <div className="upload-options">
            <label className="upload-field">
              <span className="upload-check-label">Spoken language</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>

            <label className={`upload-check${audioRefusal ? " disabled" : ""}`}>
              <span>
                <span className="upload-check-label">Keep the audio for playback</span>
                <span className="dim">
                  {audioRefusal ?? `Saved in this workspace for everyone to play back. Recordings up to ${formatBytes(MAX_AUDIO_BYTES)} are kept; larger ones are transcribed only.`}
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={keepAudio && !audioRefusal}
                disabled={!!audioRefusal}
                onChange={(e) => setKeepAudio(e.target.checked)}
              />
            </label>
            </div>
          </>
        )}

        {busy && run && (
          <div className="upload-progress" aria-live="polite">
            <div
              className="upload-bar"
              role="progressbar"
              aria-label="Upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(overall(run) * 100)}
            >
              <span style={{ width: `${Math.max(2, overall(run) * 100)}%` }} />
            </div>
            <ol className="upload-steps">
              {STEPS.map((s, i) => {
                const state = i < currentIndex ? "done" : i === currentIndex ? "active" : "todo";
                return (
                  <li key={s.id} className={`upload-step ${state}`}>
                    <span className="upload-step-mark" aria-hidden="true">
                      {state === "done" ? <Icon name="check" size={12} /> : null}
                    </span>
                    <span>{s.label}</span>
                    {state === "active" && (s.id === "load" || s.id === "transcribe" || s.id === "voices" || s.id === "diarize") && (
                      <span className="dim mono">{run.bytes && run.bytes.total ? formatDownload(run.bytes) : `${Math.round(run.fraction * 100)}%`}</span>
                    )}
                    {state === "active" && (
                      <span
                        className="upload-step-bar"
                        role="progressbar"
                        aria-label={s.label}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(run.fraction * 100)}
                      >
                        <span style={{ width: `${Math.max(2, run.fraction * 100)}%` }} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
            {(run.step === "load" || run.step === "voices") && (
              <p className="dim upload-note">The first upload downloads the models once; later uploads start at once.</p>
            )}
          </div>
        )}

        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        {saved && !busy && (
          <p className="upload-saved" role="status">
            {saved.note}
          </p>
        )}

        <div className="row end upload-actions">
          {busy ? (
            <button type="button" className="btn ghost" onClick={cancel}>
              Cancel
            </button>
          ) : (
            <>
              <button type="button" className="btn ghost" onClick={close}>
                Close
              </button>
              {saved ? (
                // Part of it is in the workspace already: open that, rather than make a second meeting.
                <button type="button" className="btn primary" onClick={() => onDone(saved.meetingId)} data-testid="upload-open">
                  Open the meeting
                </button>
              ) : (
                <button type="button" className="btn primary" disabled={!file} onClick={() => void start()} data-testid="upload-start">
                  <Upload size={16} aria-hidden="true" /> Transcribe
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
