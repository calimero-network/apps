import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FromSpeech, ToSpeech } from "./ai/speechProtocol";
import type { DeviceInfo } from "./lib/device";
import { TellVoices, type VoicesWorkerFactory } from "./TellVoices";

afterEach(cleanup);

const strong: DeviceInfo = { webgpu: false, maxBufferSize: 0, memoryGb: 8, cores: 8, chromeOS: false, mobile: false, gpu: null, cached: [] };
const lines = [
  { seq: 0, speaker: "others", name: "", startMs: 0, endMs: 2_000, text: "Morning" },
  { seq: 1, speaker: "others", name: "", startMs: 2_100, endMs: 4_000, text: "Hi" },
  { seq: 2, speaker: "you", name: "", startMs: 4_100, endMs: 5_000, text: "Hello" },
];

function setup({ device = strong, hold = false }: { device?: DeviceInfo; hold?: boolean } = {}) {
  const named: { meetingId: string; names: { seq: number; name: string }[] }[] = [];
  const act = vi.fn(async (fn: (c: unknown) => Promise<unknown>) =>
    fn({ nameSegments: async (args: (typeof named)[number]) => (named.push(args), args.names.length) }),
  );
  const sent: ToSpeech[] = [];
  const terminate = vi.fn();
  const createWorker: VoicesWorkerFactory = () => {
    const w = {
      onmessage: null as ((e: MessageEvent<FromSpeech>) => void) | null,
      onerror: null,
      terminate,
      postMessage: (m: ToSpeech) => {
        sent.push(m);
        if (hold) return;
        setTimeout(() => {
          w.onmessage?.({ data: { type: "progress", stage: "diarize", fraction: 0.5 } } as unknown as MessageEvent<FromSpeech>);
          w.onmessage?.({
            data: { type: "done", chunks: [], turns: [{ start: 0, end: 2.05, id: 4 }, { start: 2.05, end: 4.1, id: 9 }] },
          } as unknown as MessageEvent<FromSpeech>);
        }, 0);
      },
    };
    return w as unknown as ReturnType<VoicesWorkerFactory>;
  };
  render(
    <TellVoices
      workspace={{ act: act as never, blobs: { appId: "app" } as never }}
      meeting={{ id: "m1", audio: { blob: "b", mime: "audio/wav", size: 10, durationMs: 5_000 } as never }}
      lines={lines}
      createWorker={createWorker}
      decode={async () => ({ audio: new Float32Array(16_000 * 5), durationMs: 5_000 })}
      getRecording={async () => new Blob(["x"])}
      detect={async () => device}
    />,
  );
  return { named, sent, terminate };
}

describe("Tell voices apart", () => {
  it("runs the voice models only, then names the unnamed lines Voice 1, Voice 2 for everyone", async () => {
    const { named, sent } = setup();
    expect(screen.getByText("2 lines have no speaker name")).toBeTruthy();
    const button = screen.getByRole("button", { name: /Tell voices apart/ });
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    fireEvent.click(button);
    expect((await screen.findByTestId("voices-done")).textContent).toMatch(/Named 2 lines by voice/);
    expect(sent.map((m) => m.type)).toEqual(["voices"]);
    expect(named).toEqual([{ meetingId: "m1", names: [{ seq: 0, name: "Voice 1" }, { seq: 1, name: "Voice 2" }] }]);
  });

  it("is off on a device that can't run the voice models, and says why", async () => {
    setup({ device: { ...strong, memoryGb: 2 } });
    await waitFor(() => expect(screen.getByRole("button", { name: /Tell voices apart/ })).toHaveProperty("disabled", true));
    expect(screen.getByText(/needs at least 4 GB/)).toBeTruthy();
  });

  it("can be cancelled while it runs, and names nothing", async () => {
    const { named, terminate } = setup({ hold: true });
    const button = screen.getByRole("button", { name: /Tell voices apart/ });
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(terminate).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: /Tell voices apart/ })).toBeTruthy();
    expect(named).toEqual([]);
  });
});
