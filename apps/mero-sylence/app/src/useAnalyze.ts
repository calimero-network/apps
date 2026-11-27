import { useCallback, useEffect, useRef, useState } from "react";
import type { SegmentView } from "./sylenceApi";
import type { Insights } from "./generated/client";
import type { Workspace } from "./useWorkspace";
import type { TalkStats } from "./lib/stats";
import { buildPeople, llmPrompt, parseLlm, toInput, type AnalyzedLine } from "./lib/insights";
import { EMOTION_MODEL, WRITERS, pickWriter, type FromInsightsWorker, type ToInsightsWorker } from "./ai/insightsProtocol";

export type AnalyzePhase = "idle" | "model" | "classifying" | "writing" | "saving" | "done" | "error";

export interface Analyze {
  phase: AnalyzePhase;
  /** 0–1 of the current phase. */
  fraction: number;
  /** What went wrong, or a note on how it went. */
  message: string | null;
  /** What the last run saved (`setInsights`'s answer), so the page can show it before any event. */
  saved: Insights | null;
  /** WebGPU is there: the profiles can be written by a Smart notes model. */
  canWrite: boolean;
  run: (opts?: { useLlm?: boolean }) => Promise<void>;
  cancel: () => void;
}

/** The insights worker as the page starts it; a test passes its own. */
export type WorkerFactory = () => Pick<Worker, "postMessage" | "terminate" | "addEventListener" | "removeEventListener">;

const defaultWorker: WorkerFactory = () => new Worker(new URL("./ai/insights.worker.ts", import.meta.url), { type: "module" });

class Cancelled extends Error {}

const hasWebGpu = () => typeof navigator !== "undefined" && "gpu" in navigator;

/**
 * Works out the people insights for a meeting on this laptop and saves them:
 * the emotion model scores every line (downloaded once, ~125 MB), the scores
 * become a tone and emotions per person, their sentences give the key points,
 * and, when asked and WebGPU is there, a Smart notes model rewrites each
 * profile and the key points. The worker starts on the first run and stops on
 * cancel or unmount.
 */
export function useAnalyze({
  workspace,
  meetingId,
  segments,
  labelOf,
  stats,
  createWorker = defaultWorker,
}: {
  workspace: Pick<Workspace, "act">;
  meetingId: string;
  segments: readonly SegmentView[];
  labelOf: (s: SegmentView) => string;
  stats: TalkStats;
  createWorker?: WorkerFactory;
}): Analyze {
  const [phase, setPhase] = useState<AnalyzePhase>("idle");
  const [fraction, setFraction] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<Insights | null>(null);
  const worker = useRef<ReturnType<WorkerFactory> | null>(null);
  const runId = useRef(0);
  const reject = useRef<((e: Error) => void) | null>(null);
  // The latest inputs, read when a run starts.
  const latest = useRef({ workspace, meetingId, segments, labelOf, stats });
  latest.current = { workspace, meetingId, segments, labelOf, stats };

  const stop = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
    reject.current?.(new Cancelled());
    reject.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const cancel = useCallback(() => {
    runId.current += 1;
    stop();
    setPhase("idle");
    setFraction(0);
    setMessage(null);
  }, [stop]);

  /** One request to the worker, answered by `pick`; progress drives the phase. */
  const ask = useCallback(
    <T,>(message: ToInsightsWorker, pick: (m: FromInsightsWorker) => T | undefined): Promise<T> => {
      worker.current ??= createWorker();
      const w = worker.current;
      return new Promise<T>((resolve, rejectFn) => {
        const onMessage = (event: Event) => {
          const m = (event as MessageEvent<FromInsightsWorker>).data;
          if (m.type === "progress") {
            setPhase(m.step === "model" ? "model" : m.step === "classify" ? "classifying" : "writing");
            setFraction(m.fraction);
            return;
          }
          if (m.type === "error" && (m.id === undefined || ("id" in message && m.id === message.id))) {
            done();
            rejectFn(new Error(m.error));
            return;
          }
          const value = pick(m);
          if (value !== undefined) {
            done();
            resolve(value);
          }
        };
        const done = () => {
          w.removeEventListener("message", onMessage);
          if (reject.current === fail) reject.current = null;
        };
        const fail = (e: Error) => {
          done();
          rejectFn(e);
        };
        reject.current = fail;
        w.addEventListener("message", onMessage);
        w.postMessage(message);
      });
    },
    [createWorker],
  );

  const run = useCallback(
    async (opts: { useLlm?: boolean } = {}) => {
      const id = ++runId.current;
      const live = () => id === runId.current;
      const { workspace: ws, meetingId: mid, segments: segs, labelOf: label, stats: st } = latest.current;
      setMessage(null);
      setFraction(0);
      if (!segs.length || !st.speakers.length) {
        setPhase("error");
        setMessage("There is no transcript to analyze yet.");
        return;
      }
      try {
        setPhase("model");
        const texts = segs.map((s) => s.text);
        const scores = await ask({ type: "classify", id, texts }, (m) => (m.type === "scores" && m.id === id ? m.scores : undefined));
        if (!live()) return;
        const lines: AnalyzedLine[] = segs.map((s, i) => ({
          label: label(s),
          startMs: s.startMs,
          text: s.text,
          words: s.text.split(/\s+/).filter(Boolean).length,
          scores: scores[i] ?? {},
        }));
        const people = buildPeople(lines, st);
        let model: string = EMOTION_MODEL.name;

        if (opts.useLlm && hasWebGpu()) {
          const writerId = pickWriter((navigator as { deviceMemory?: number }).deviceMemory);
          setPhase("writing");
          setFraction(0);
          try {
            // Loads in the background; a load error answers the first generate.
            worker.current ??= createWorker();
            worker.current.postMessage({ type: "loadWriter", model: writerId } satisfies ToInsightsWorker);
            let wrote = 0;
            for (let i = 0; i < people.length; i++) {
              const p = people[i]!;
              const mine = lines.filter((l) => l.label === p.label);
              const speaker = st.speakers.find((s) => s.label === p.label);
              const text = await ask(
                { type: "generate", id: id * 1000 + i, messages: llmPrompt(p.label, mine, { tone: p.tone as never, share: speaker?.share ?? 0 }) },
                (m) => (m.type === "text" && m.id === id * 1000 + i ? m.text : undefined),
              );
              if (!live()) return;
              const parsed = parseLlm(text, mine);
              if (parsed) {
                p.profile = parsed.profile;
                if (parsed.keyPoints.length) p.keyPoints = parsed.keyPoints;
                wrote += 1;
              }
              setFraction((i + 1) / people.length);
            }
            if (wrote) model = `${EMOTION_MODEL.name} + ${WRITERS[writerId].name}`;
          } catch (e) {
            if (e instanceof Cancelled) throw e;
            if (!live()) return;
            setMessage(`The writing model did not run (${e instanceof Error ? e.message : String(e)}); profiles are from the emotion model and stats.`);
          }
        }

        if (!live()) return;
        setPhase("saving");
        const result = await ws.act((c) => c.setInsights({ meetingId: mid, insights: toInput(people, model) }));
        if (!live()) return;
        setSaved(result);
        setPhase("done");
        setFraction(1);
      } catch (e) {
        if (e instanceof Cancelled || !live()) return;
        setPhase("error");
        setMessage(e instanceof Error ? e.message : String(e));
      } finally {
        // The models (up to about 1.3 GB with the writer) are not kept between runs; the next run reads them from the browser cache.
        if (live()) {
          worker.current?.terminate();
          worker.current = null;
          reject.current = null;
        }
      }
    },
    [ask, createWorker],
  );

  return { phase, fraction, message, saved, canWrite: hasWebGpu(), run, cancel };
}
