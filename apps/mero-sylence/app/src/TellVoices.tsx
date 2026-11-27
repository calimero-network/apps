import { useEffect, useRef, useState } from "react";
import type { FromSpeech, ToSpeech } from "./ai/speechProtocol";
import { detectDevice, uploadPlan, type DeviceInfo } from "./lib/device";
import { decodeTo16kMono } from "./lib/upload";
import { inRuns, unnamedLines, voiceNames, type VoiceLine } from "./lib/voices";
import type { MeetingView } from "./sylenceApi";
import type { Workspace } from "./useWorkspace";
import { recordingBlob } from "./useRecording";
import { Icon } from "./ui";

export type VoicesWorkerFactory = () => Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror">;
const defaultWorker: VoicesWorkerFactory = () => new Worker(new URL("./ai/speech.worker.ts", import.meta.url), { type: "module" });

type Run =
  | { phase: "idle" }
  | { phase: "running"; step: string; fraction: number }
  | { phase: "done"; named: number }
  | { phase: "error"; error: string };

/**
 * "Tell voices apart": for a call whose page showed no names, the saved
 * recording is played through the voice models on this laptop (no transcript
 * is redone), and each unnamed line is named after its voice, "Voice 1",
 * "Voice 2", for everyone in the workspace. Rename a voice afterwards in Talk
 * time. The recorder or the workspace's owner.
 */
export function TellVoices({
  workspace,
  meeting,
  lines,
  createWorker = defaultWorker,
  decode = decodeTo16kMono,
  getRecording = recordingBlob,
  detect = detectDevice,
}: {
  workspace: Pick<Workspace, "act" | "blobs">;
  meeting: Pick<MeetingView, "id" | "audio">;
  lines: readonly VoiceLine[];
  createWorker?: VoicesWorkerFactory;
  decode?: typeof decodeTo16kMono;
  getRecording?: typeof recordingBlob;
  detect?: () => Promise<DeviceInfo>;
}) {
  const [run, setRun] = useState<Run>({ phase: "idle" });
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const worker = useRef<ReturnType<VoicesWorkerFactory> | null>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    let live = true;
    void detect()
      .then((d) => live && setDevice(d))
      .catch(() => undefined);
    return () => {
      live = false;
      worker.current?.terminate();
    };
  }, [detect]);
  const plan = device ? uploadPlan(device) : null;
  const unnamed = unnamedLines(lines).length;

  const cancel = () => {
    cancelled.current = true;
    worker.current?.terminate();
    worker.current = null;
    setRun({ phase: "idle" });
  };

  const start = async () => {
    if (!meeting.audio) return;
    cancelled.current = false;
    setRun({ phase: "running", step: "Reading the recording", fraction: 0 });
    try {
      const blob = await getRecording(workspace.blobs, meeting.audio);
      const { audio } = await decode(blob);
      if (cancelled.current) return;
      setRun({ phase: "running", step: "Loading the voice models", fraction: 0.1 });
      const turns = await new Promise<Extract<FromSpeech, { type: "done" }>["turns"]>((resolve, reject) => {
        const w = createWorker();
        worker.current = w;
        w.onmessage = (e: MessageEvent<FromSpeech>) => {
          const m = e.data;
          if (m.type === "progress") {
            setRun({
              phase: "running",
              step: m.stage === "voices" ? "Loading the voice models" : "Telling voices apart",
              fraction: m.stage === "voices" ? 0.1 + m.fraction * 0.3 : 0.4 + m.fraction * 0.5,
            });
          } else if (m.type === "done") resolve(m.turns);
          else if (m.type === "error") reject(new Error(m.error));
        };
        w.onerror = (e) => reject(new Error(e.message || "the voice models stopped"));
        const msg: ToSpeech = { type: "voices", audio };
        w.postMessage(msg, [audio.buffer]);
      });
      worker.current?.terminate();
      worker.current = null;
      if (cancelled.current) return;
      const names = voiceNames(lines, turns);
      if (!names.length) {
        setRun({ phase: "error", error: "No separate voices were found in the recording." });
        return;
      }
      setRun({ phase: "running", step: "Saving the names", fraction: 0.9 });
      let named = 0;
      for (const batch of inRuns(names)) {
        if (cancelled.current) return;
        named += Number(await workspace.act((c) => c.nameSegments({ meetingId: meeting.id, names: batch })));
      }
      setRun({ phase: "done", named });
    } catch (e) {
      if (cancelled.current) return;
      worker.current?.terminate();
      worker.current = null;
      setRun({ phase: "error", error: e instanceof Error ? e.message : String(e) });
    }
  };

  if (run.phase === "done") {
    return (
      <p className="voices-note" role="status" data-testid="voices-done">
        <Icon name="check" size={14} /> Named {run.named} {run.named === 1 ? "line" : "lines"} by voice. Rename a voice in Talk time.
      </p>
    );
  }
  if (!unnamed) return null;
  if (run.phase === "running") {
    return (
      <div className="voices-run" aria-live="polite" data-testid="voices-running">
        <span className="voices-step">
          <span className="btn-spinner" aria-hidden="true" /> {run.step}…
        </span>
        <span className="voices-bar" role="progressbar" aria-valuenow={Math.round(run.fraction * 100)} aria-label={run.step}>
          <span style={{ width: `${Math.max(3, run.fraction * 100)}%` }} />
        </span>
        <button type="button" className="btn small ghost" onClick={cancel}>
          Cancel
        </button>
      </div>
    );
  }
  const blocked = plan && !plan.ok ? plan.reason : null;
  return (
    <div className="voices-offer" data-testid="tell-voices">
      <span className="grow">
        <span className="strong">
          {unnamed} {unnamed === 1 ? "line has" : "lines have"} no speaker name
        </span>
        <span className="dim small">
          {blocked ?? "Tell the voices apart from the recording, on this laptop. Lines are named Voice 1, Voice 2, … for everyone."}
        </span>
        {run.phase === "error" && (
          <span className="err small" role="alert">
            {run.error}
          </span>
        )}
      </span>
      <button type="button" className="btn small" onClick={() => void start()} disabled={!!blocked || !plan}>
        <Icon name="users" size={14} /> Tell voices apart
      </button>
    </div>
  );
}
