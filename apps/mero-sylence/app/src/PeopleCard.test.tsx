import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionView, Insights, SegmentView } from "./generated/client";
import { PeopleCard } from "./PeopleCard";
import { talkStats } from "./lib/stats";
import { useAnalyze, type Analyze, type WorkerFactory } from "./useAnalyze";
import type { FromInsightsWorker, ToInsightsWorker } from "./ai/insightsProtocol";

afterEach(cleanup);

const stats = talkStats(
  [
    { startMs: 0, endMs: 6_000, text: "We ship Friday.", label: "Speaker 1" },
    { startMs: 6_000, endMs: 9_000, text: "Who tests it?", label: "Speaker 2" },
  ],
  (s) => s.label,
);

const analyze = (over: Partial<Analyze> = {}): Analyze => ({
  phase: "idle",
  fraction: 0,
  message: null,
  canWrite: false,
  run: vi.fn(async () => {}),
  cancel: vi.fn(),
  ...over,
});

const insights: Insights = {
  model: "go-emotions",
  updatedBy: "bob",
  updatedAt: "1764000000000",
  people: [
    {
      label: "Speaker 1",
      tone: "enthusiastic",
      profile: "Enthusiastic and talked the most (67% of the meeting).",
      emotions: [
        { label: "excitement", share: 520 },
        { label: "neutral", share: 300 },
        { label: "joy", share: 120 },
      ],
      keyPoints: ["We ship Friday."],
    },
  ],
};

const action: ActionView = {
  id: "a1",
  meetingId: "m",
  text: "Write the release notes",
  assignee: "eve",
  done: false,
  sourceSeq: 0,
  createdBy: "bob",
  createdAt: "1",
  updatedAt: "1",
};

const names = (label: string) => (label === "Speaker 1" ? "Eve" : label);

describe("PeopleCard", () => {
  it("offers to analyze when nothing is saved", () => {
    const a = analyze();
    render(<PeopleCard insights={null} stats={stats} actions={[]} displayName={names} canAnalyze analyze={a} />);
    expect(screen.getByText(/runs on this laptop/)).toBeTruthy();
    expect(screen.getAllByTestId("person")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Analyze/ }));
    expect(a.run).toHaveBeenCalledWith({ useLlm: false });
    expect(screen.queryByLabelText(/Smart notes/)).toBeNull();
  });

  it("offers the writing model with WebGPU", () => {
    const a = analyze({ canWrite: true });
    render(<PeopleCard insights={null} stats={stats} actions={[]} displayName={names} canAnalyze analyze={a} />);
    fireEvent.click(screen.getByLabelText(/Write profiles with Smart notes model/));
    fireEvent.click(screen.getByRole("button", { name: /Analyze/ }));
    expect(a.run).toHaveBeenCalledWith({ useLlm: true });
  });

  it("shows progress and cancels", () => {
    const a = analyze({ phase: "classifying", fraction: 0.4 });
    render(<PeopleCard insights={null} stats={stats} actions={[]} displayName={names} canAnalyze analyze={a} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(a.cancel).toHaveBeenCalled();
  });

  it("shows tone, emotions, profile, key points and the person's action items", () => {
    render(<PeopleCard insights={insights} stats={stats} actions={[action]} displayName={names} canAnalyze analyze={analyze()} />);
    const [eve, other] = screen.getAllByTestId("person");
    const e = within(eve!);
    expect(e.getByText("Eve")).toBeTruthy();
    expect(e.getByText("Speaker 1")).toBeTruthy();
    expect(e.getByText("Enthusiastic")).toBeTruthy();
    expect(e.getByText(/talked the most/)).toBeTruthy();
    expect(e.getByText("excitement")).toBeTruthy();
    expect(e.queryByText("neutral")).toBeNull();
    expect(e.getByText("We ship Friday.")).toBeTruthy();
    expect(e.getByText("Write the release notes")).toBeTruthy();
    expect(within(other!).queryByText("Write the release notes")).toBeNull();
    expect(screen.getByRole("button", { name: /Re-analyze/ })).toBeTruthy();
    expect(screen.getByText(/go-emotions/)).toBeTruthy();
  });

  it("is read-only for people who cannot analyze", () => {
    render(<PeopleCard insights={null} stats={stats} actions={null} displayName={names} canAnalyze={false} analyze={analyze()} />);
    expect(screen.queryByRole("button", { name: /Analyze/ })).toBeNull();
    expect(screen.getByText(/recorder can analyze/)).toBeTruthy();
  });

  it("jumps to where a person first spoke", () => {
    const onSeek = vi.fn();
    render(<PeopleCard insights={null} stats={stats} actions={[]} displayName={names} canAnalyze={false} analyze={analyze()} onSeek={onSeek} />);
    fireEvent.click(screen.getAllByRole("button", { name: /First spoke at/ })[1]!);
    expect(onSeek).toHaveBeenCalledWith(6_000);
  });
});

// ── useAnalyze, with a fake worker ──────────────────────────────────────────

function fakeWorker(answer: (m: ToInsightsWorker, post: (r: FromInsightsWorker) => void) => void) {
  const listeners = new Set<(e: Event) => void>();
  const terminate = vi.fn();
  const w = {
    postMessage: (m: ToInsightsWorker) =>
      queueMicrotask(() => answer(m, (r) => listeners.forEach((l) => l({ data: r } as MessageEvent)))),
    terminate,
    addEventListener: (_: string, l: (e: Event) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: Event) => void) => listeners.delete(l),
  };
  return { factory: (() => w) as unknown as WorkerFactory, terminate };
}

const segs: SegmentView[] = [
  { seq: 0, startMs: 0, endMs: 6_000, speaker: "others", name: "Speaker 1", text: "We decided to ship the beta on Friday.", edited: false },
  { seq: 1, startMs: 6_000, endMs: 9_000, speaker: "others", name: "Speaker 2", text: "Who tests it before then?", edited: false },
];
const segStats = talkStats(segs, (s) => s.name);

describe("useAnalyze", () => {
  it("classifies every line and saves the insights", async () => {
    const { factory } = fakeWorker((m, post) => {
      if (m.type === "classify") {
        post({ type: "progress", step: "classify", fraction: 0.5 });
        post({ type: "scores", id: m.id, scores: [{ excitement: 0.9 }, { curiosity: 0.9 }] });
      }
    });
    const setInsights = vi.fn(async () => null);
    const workspace = { act: async <T,>(fn: (c: never) => Promise<T>) => fn({ setInsights } as never) };
    const { result } = renderHook(() =>
      useAnalyze({ workspace: workspace as never, meetingId: "m1", segments: segs, labelOf: (s) => s.name, stats: segStats, createWorker: factory }),
    );
    await act(() => result.current.run());
    expect(result.current.phase).toBe("done");
    const args = (setInsights.mock.calls[0] as unknown as [{ meetingId: string; insights: { model: string; people: { label: string; tone: string }[] } }])[0];
    expect(args.meetingId).toBe("m1");
    expect(args.insights.model).toBe("go-emotions");
    expect(args.insights.people.map((p) => [p.label, p.tone])).toEqual([
      ["Speaker 1", "enthusiastic"],
      ["Speaker 2", "curious"],
    ]);
  });

  it("reports a model error and cancels cleanly", async () => {
    const { factory, terminate } = fakeWorker((m, post) => {
      if (m.type === "classify") post({ type: "error", id: m.id, error: "no network" });
    });
    const workspace = { act: vi.fn() };
    const { result } = renderHook(() =>
      useAnalyze({ workspace: workspace as never, meetingId: "m1", segments: segs, labelOf: (s) => s.name, stats: segStats, createWorker: factory }),
    );
    await act(() => result.current.run());
    expect(result.current.phase).toBe("error");
    expect(result.current.message).toBe("no network");
    expect(workspace.act).not.toHaveBeenCalled();
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(terminate).toHaveBeenCalled();
  });
});
