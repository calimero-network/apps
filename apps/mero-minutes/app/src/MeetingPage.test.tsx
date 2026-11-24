import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionView, SegmentView } from "./minutesApi";
import { MeetingPage } from "./MeetingPage";
import { fakeWorkspace, meeting } from "./test/workspace";

afterEach(cleanup);

const seg = (seq: number, text: string, speaker = "others"): SegmentView => ({
  seq,
  startMs: seq * 65_000,
  endMs: seq * 65_000 + 2_500,
  speaker,
  text,
  edited: false,
});

const action = (over: Partial<ActionView> = {}): ActionView => ({
  id: "act1",
  meetingId: "aa11",
  text: "Send the deck",
  assignee: "Cy",
  done: false,
  sourceSeq: null,
  createdBy: "cy",
  createdAt: "1",
  updatedAt: "1",
  ...over,
});

function setup({
  me = "bob",
  isOwner = false,
  live = false,
  pages = [[seg(0, "Morning all", "you"), seg(1, "Cy will send the deck")]],
  focusSeq,
}: { me?: string; isOwner?: boolean; live?: boolean; pages?: SegmentView[][]; focusSeq?: number } = {}) {
  let actions: ActionView[] = [action()];
  let page = 0;
  const transcriptLines = new Map<number, SegmentView>();
  for (const p of pages) for (const s of p) transcriptLines.set(s.seq, s);
  const fake = fakeWorkspace({
    getMeeting: () => meeting({ live }),
    listActions: () => actions,
    transcript: (args) => {
      const from = args.fromSeq as number;
      if (from === 0 || page < pages.length) {
        const answer = pages[page] ?? [];
        const next = page + 1 < pages.length ? (pages[page + 1]![0]!.seq) : null;
        page += 1;
        if (from === 0 || answer.length) return { segments: answer, next };
      }
      const limit = args.limit as number;
      return { segments: [...transcriptLines.values()].filter((s) => s.seq >= from && s.seq < from + limit), next: null };
    },
    addAction: (args) => {
      actions = [...actions, action({ id: "act2", text: args.text as string, assignee: args.assignee as string, sourceSeq: (args.sourceSeq as number | null) ?? null, createdBy: me })];
      return "act2";
    },
    setActionDone: (args) => {
      actions = actions.map((a) => (a.id === args.actionId ? { ...a, done: args.done as boolean } : a));
      return actions.find((a) => a.id === args.actionId);
    },
    editSegment: (args) => ({ ...seg(args.seq as number, args.text as string), edited: true }),
    removeAction: () => null,
    deleteMeeting: (() => {
      let left = 1_200;
      return () => {
        left = Math.max(0, left - 1_000);
        return { remaining: left };
      };
    })(),
  });
  const onBack = vi.fn();
  render(<MeetingPage workspace={fake.workspace} meetingId="aa11" me={me} isOwner={isOwner} onBack={onBack} focusSeq={focusSeq} />);
  return { ...fake, onBack, addLine: (s: SegmentView) => transcriptLines.set(s.seq, s) };
}


describe("MeetingPage", () => {
  it("shows the transcript with speakers and timestamps", async () => {
    setup({ me: "cy" });
    const lines = await screen.findAllByTestId("segment");
    expect(lines).toHaveLength(2);
    expect(within(lines[0]!).getByText("0:00")).toBeTruthy();
    expect(within(lines[1]!).getByText("1:05")).toBeTruthy();
    // Bob recorded it; Cy reads it: Bob's mic is "bob" shortened, the call is "Others".
    expect(lines[0]!.querySelector(".speaker-chip")!.textContent).toBe("bob");
    expect(lines[1]!.querySelector(".speaker-chip")!.textContent).toBe("Others");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Weekly sync");
  });

  it("gives the recorder the edit controls and nobody else", async () => {
    setup({ me: "cy" });
    await screen.findAllByTestId("segment");
    expect(screen.queryByRole("button", { name: "Rename meeting" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit line" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Write one/ })).toBeNull();
  });

  it("lets the recorder correct a line", async () => {
    const { sent } = setup({ me: "bob" });
    const lines = await screen.findAllByTestId("segment");
    expect(lines[0]!.querySelector(".speaker-chip")!.textContent).toBe("You");
    fireEvent.click(within(lines[1]!).getByRole("button", { name: "Edit line" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Segment text" }), { target: { value: "Cy sends the deck" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Cy sends the deck");
    expect(sent.find((s) => s.method === "editSegment")!.args).toEqual({ meetingId: "aa11", seq: 1, text: "Cy sends the deck" });
    expect(await screen.findByText("(edited)", { exact: false })).toBeTruthy();
  });

  it("lets the owner delete someone else's meeting, in batches", async () => {
    const { sent, onBack } = setup({ me: "owner", isOwner: true });
    await screen.findAllByTestId("segment");
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete for everyone" }));
    await waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(sent.filter((s) => s.method === "deleteMeeting")).toHaveLength(2);
  });

  it("adds an action item and ticks one off", async () => {
    const { sent } = setup({ me: "cy" });
    await screen.findAllByTestId("action-item");
    fireEvent.change(screen.getByRole("textbox", { name: "New action item" }), { target: { value: "Book the room" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Assignee" }), { target: { value: "Gus" } });
    fireEvent.click(screen.getByRole("button", { name: /Add/ }));
    await waitFor(() => expect(sent.some((s) => s.method === "addAction")).toBe(true));
    expect(sent.find((s) => s.method === "addAction")!.args).toEqual({
      meetingId: "aa11",
      text: "Book the room",
      assignee: "Gus",
      sourceSeq: null,
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Done: Send the deck" }));
    await waitFor(() => expect(sent.some((s) => s.method === "setActionDone")).toBe(true));
    expect(sent.find((s) => s.method === "setActionDone")!.args).toEqual({ actionId: "act1", done: true });
  });

  it("makes an action item from a line of the transcript", async () => {
    const { sent } = setup({ me: "cy" });
    const lines = await screen.findAllByTestId("segment");
    fireEvent.click(within(lines[1]!).getByRole("button", { name: "Make action item" }));
    await waitFor(() => expect(sent.some((s) => s.method === "addAction")).toBe(true));
    expect(sent.find((s) => s.method === "addAction")!.args).toEqual({
      meetingId: "aa11",
      text: "Cy will send the deck",
      assignee: "",
      sourceSeq: 1,
    });
  });

  it("loads the transcript a page at a time", async () => {
    const { sent } = setup({ me: "cy", pages: [[seg(0, "first")], [seg(1, "second")]] });
    await screen.findByText("first");
    expect(screen.queryByText("second")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("second");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(sent.filter((s) => s.method === "transcript").map((s) => s.args.fromSeq)).toEqual([0, 1]);
  });

  it("appends lines live from TranscriptChanged, reading only that range", async () => {
    const { emit, sent, addLine } = setup({ me: "cy", live: true });
    await screen.findAllByTestId("segment");
    expect(screen.getAllByTestId("live-badge")).toHaveLength(1);
    addLine(seg(2, "a new line"));
    act(() => emit({ kind: "TranscriptChanged", data: { meetingId: "aa11", from: 2, to: 3 } }));
    await screen.findByText("a new line");
    const reads = sent.filter((s) => s.method === "transcript");
    expect(reads[reads.length - 1]!.args).toEqual({ meetingId: "aa11", fromSeq: 2, limit: 1 });
    // Another meeting's change is not read.
    act(() => emit({ kind: "TranscriptChanged", data: { meetingId: "other", from: 0, to: 9 } }));
    expect(sent.filter((s) => s.method === "transcript")).toHaveLength(reads.length);
  });

  it("finds in the transcript: reads every page, keeps matching lines, marks the words", async () => {
    setup({ pages: [[seg(0, "Morning all", "you"), seg(1, "Cy will send the deck")], [seg(2, "The DECK is late"), seg(3, "Fine")]] });
    await screen.findAllByTestId("segment");
    fireEvent.change(screen.getByRole("searchbox", { name: "Find in transcript" }), { target: { value: "deck" } });
    await waitFor(() => expect(screen.getAllByTestId("segment")).toHaveLength(2));
    const lines = screen.getAllByTestId("segment");
    expect(lines.map((l) => l.querySelector(".segment-text")!.textContent)).toEqual(["Cy will send the deck", "The DECK is late"]);
    expect([...document.querySelectorAll(".segment-text mark")].map((m) => m.textContent)).toEqual(["deck", "DECK"]);
    expect(screen.getByTestId("line-count").textContent).toContain("2 of");
    fireEvent.change(screen.getByRole("searchbox", { name: "Find in transcript" }), { target: { value: "zebra" } });
    expect(await screen.findByText(/No line contains/)).toBeTruthy();
  });

  it("opens at a linked line: reads up to it and marks it", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    setup({ pages: [[seg(0, "Morning all", "you"), seg(1, "One")], [seg(2, "Two"), seg(3, "The line we want")]], focusSeq: 3 });
    await waitFor(() => expect(document.getElementById("line-3")).toBeTruthy());
    expect(document.getElementById("line-3")!.className).toContain("focused");
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
  });
});
