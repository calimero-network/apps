import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FromSpeech } from "./ai/speechProtocol";
import { UploadRecording, type SpeechWorkerFactory } from "./UploadRecording";
import { MAX_AUDIO_BYTES } from "./lib/upload";
import { fakeWorkspace, meeting, type Handler } from "./test/workspace";

afterEach(cleanup);

// jsdom's Blob has no arrayBuffer().
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(this);
    });
  };
}

/** A speech worker that answers a run with some progress, then `done`. */
function fakeWorker(done: Extract<FromSpeech, { type: "done" }>): SpeechWorkerFactory & { made: number } {
  const factory = (() => {
    factory.made += 1;
    const w = {
      onmessage: null as ((e: MessageEvent<FromSpeech>) => void) | null,
      onerror: null,
      terminate: vi.fn(),
      postMessage: vi.fn(() => {
        const send = (data: FromSpeech) => w.onmessage?.({ data } as MessageEvent<FromSpeech>);
        setTimeout(() => {
          send({ type: "progress", stage: "load", fraction: 0.5, bytes: { loaded: 5, total: 10 } });
          send({ type: "model", modelId: "whisper-base", name: "Whisper base" });
          send({ type: "progress", stage: "transcribe", fraction: 1 });
          send(done);
        }, 0);
      }),
    };
    return w as unknown as ReturnType<SpeechWorkerFactory>;
  }) as SpeechWorkerFactory & { made: number };
  factory.made = 0;
  return factory;
}

/** 150 one-second lines, two voices, one of them an action item. */
const DONE: Extract<FromSpeech, { type: "done" }> = {
  type: "done",
  chunks: Array.from({ length: 150 }, (_, i) => ({
    start: i,
    end: i + 0.9,
    text: i === 3 ? "I will send the deck to the design team tomorrow." : `Line number ${i}.`,
  })),
  turns: [
    { start: 0, end: 75, id: 0 },
    { start: 75, end: 151, id: 1 },
  ],
};

const decode = vi.fn(async () => ({ audio: new Float32Array(16_000 * 150), durationMs: 150_000 }));
const probe = vi.fn(async () => 150_000 as number | null);

function setup(handlers: Record<string, Handler> = {}, opts: { decode?: typeof decode; probe?: typeof probe } = {}) {
  const order: string[] = [];
  const track =
    (method: string, answer: Handler): Handler =>
    (args) => {
      order.push(method);
      return answer(args);
    };
  const fake = fakeWorkspace({
    startMeeting: track("startMeeting", () => "m1"),
    appendSegments: track("appendSegments", (a) => ({ added: (a.segments as unknown[]).length, skipped: 0, nextSeq: 0 })),
    attachAudio: track("attachAudio", () => meeting({ id: "m1" })),
    endMeeting: track("endMeeting", () => meeting({ id: "m1" })),
    addAction: track("addAction", () => "a1"),
    ...handlers,
  });
  type Upload = (bytes: Uint8Array, mime: string) => Promise<{ blobId: string; size: number }>;
  const upload = fake.workspace.blobs.upload as unknown as ReturnType<typeof vi.fn<Upload>>;
  const realUpload = upload.getMockImplementation()!;
  upload.mockImplementation(async (bytes, mime) => {
    order.push("upload");
    return realUpload(bytes, mime);
  });
  const worker = fakeWorker(DONE);
  const onDone = vi.fn();
  render(
    <UploadRecording
      workspace={fake.workspace}
      onDone={onDone}
      onClose={() => {}}
      createWorker={worker}
      decode={opts.decode ?? decode}
      probe={opts.probe ?? probe}
    />,
  );
  return { ...fake, order, onDone, worker, upload };
}

function choose(size = 3, name = "standup.mp3") {
  const file = new File([new Uint8Array(Math.min(size, 3))], name, { type: "audio/mpeg" });
  if (size > 1_000) Object.defineProperty(file, "size", { value: size });
  fireEvent.change(screen.getByTestId("upload-file"), { target: { files: [file] } });
}

describe("UploadRecording", () => {
  it("saves the transcript, then the audio, ends the meeting and adds the action items", async () => {
    const { order, sent, onDone, upload } = setup();
    choose();
    fireEvent.click(screen.getByTestId("upload-start"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("m1"));
    const firstAction = order.indexOf("addAction");
    expect(order.slice(0, firstAction)).toEqual(["startMeeting", "appendSegments", "appendSegments", "upload", "attachAudio", "endMeeting"]);
    expect(firstAction).toBeGreaterThan(0);
    const start = sent.find((s) => s.method === "startMeeting")!.args;
    expect(start).toMatchObject({ title: "standup", platform: "upload", url: "", model: "whisper-base", language: "en" });
    const batches = sent.filter((s) => s.method === "appendSegments").map((s) => (s.args.segments as unknown[]).length);
    expect(batches).toEqual([100, 50]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(sent.find((s) => s.method === "attachAudio")!.args).toMatchObject({ meetingId: "m1", mime: "audio/mpeg", durationMs: 150_000 });
  });

  it("keeps no audio for a file too large for one blob", async () => {
    const { order, onDone, upload } = setup();
    choose(MAX_AUDIO_BYTES + 1);
    expect(screen.getByText(/The transcript is saved without the audio/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("upload-start"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("m1"));
    expect(upload).not.toHaveBeenCalled();
    expect(order).not.toContain("attachAudio");
  });

  it("refuses a recording over four hours before decoding it", async () => {
    const decodeSpy = vi.fn(async () => ({ audio: new Float32Array(16), durationMs: 1_000 }));
    const { order } = setup({}, { decode: decodeSpy, probe: vi.fn(async () => 5 * 60 * 60_000) });
    choose();
    fireEvent.click(screen.getByTestId("upload-start"));
    expect(await screen.findByText("Recordings up to 4 hours can be uploaded.")).toBeTruthy();
    expect(decodeSpy).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it("ends a half-saved meeting when cancelled and offers to open it", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { order, onDone } = setup({
      appendSegments: async (a) => {
        order.push("appendSegments");
        await gate;
        return { added: (a.segments as unknown[]).length, skipped: 0, nextSeq: 0 };
      },
    });
    choose();
    fireEvent.click(screen.getByTestId("upload-start"));
    await waitFor(() => expect(order).toContain("appendSegments"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(order).toContain("endMeeting"));
    expect(screen.queryByText(/Nothing was saved/)).toBeNull();
    expect(screen.getByText(/the rest was cancelled/)).toBeTruthy();
    await act(async () => release());
    expect(order).not.toContain("attachAudio");
    expect(order).not.toContain("addAction");
    expect(screen.queryByTestId("upload-start")).toBeNull();
    fireEvent.click(screen.getByTestId("upload-open"));
    expect(onDone).toHaveBeenCalledWith("m1");
  });

  it("starts one meeting when cancelled and started again while decoding", async () => {
    let first = true;
    let releaseFirst: () => void = () => {};
    const slowThenFast = vi.fn(async () => {
      if (first) {
        first = false;
        await new Promise<void>((r) => (releaseFirst = r));
      }
      return { audio: new Float32Array(16_000 * 150), durationMs: 150_000 };
    });
    const { order, onDone } = setup({}, { decode: slowThenFast });
    choose();
    fireEvent.click(screen.getByTestId("upload-start"));
    await waitFor(() => expect(slowThenFast).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Cancelled. Nothing was saved.")).toBeTruthy();
    fireEvent.click(screen.getByTestId("upload-start"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("m1"));
    await act(async () => releaseFirst());
    await new Promise((r) => setTimeout(r, 10));
    expect(order.filter((m) => m === "startMeeting")).toHaveLength(1);
  });

  it("ends the meeting when attaching the audio fails, and does not start a second one", async () => {
    const { order, onDone } = setup({
      attachAudio: () => {
        order.push("attachAudio");
        throw new Error("the node refused the recording");
      },
    });
    choose();
    fireEvent.click(screen.getByTestId("upload-start"));
    expect(await screen.findByText("the node refused the recording")).toBeTruthy();
    await waitFor(() => expect(order).toContain("endMeeting"));
    expect(screen.getByText(/The transcript is saved; the rest did not finish/)).toBeTruthy();
    expect(screen.queryByTestId("upload-start")).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
    expect(order.filter((m) => m === "startMeeting")).toHaveLength(1);
  });
});
