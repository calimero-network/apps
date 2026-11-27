import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayer, usePlayingIndex, type PlayerState } from "./usePlayer";

afterEach(cleanup);

const lines = [
  { startMs: 0, endMs: 1_000 },
  { startMs: 2_000, endMs: 3_000 },
];

function Harness({ onPlayer, onRender }: { onPlayer: (p: PlayerState) => void; onRender: () => void }) {
  const player = usePlayer();
  onPlayer(player);
  const index = usePlayingIndex(player, lines, true);
  onRender();
  return (
    <>
      <audio data-testid="audio" {...player.bind} />
      <span data-testid="index">{index}</span>
    </>
  );
}

describe("usePlayer", () => {
  it("plays after a seek asked for before the audio was ready", () => {
    let player!: PlayerState;
    const { getByTestId } = render(<Harness onPlayer={(p) => (player = p)} onRender={() => {}} />);
    const audio = getByTestId("audio") as HTMLAudioElement;
    const play = vi.spyOn(audio, "play").mockResolvedValue(undefined);
    Object.defineProperty(audio, "readyState", { value: 0, configurable: true });
    act(() => player.seek(2_500, true));
    expect(play).not.toHaveBeenCalled();
    Object.defineProperty(audio, "readyState", { value: 1, configurable: true });
    fireEvent(audio, new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(2.5);
    expect(play).toHaveBeenCalledOnce();
  });

  it("re-renders the transcript only when the playing line changes", () => {
    let player!: PlayerState;
    let renders = 0;
    const { getByTestId } = render(<Harness onPlayer={(p) => (player = p)} onRender={() => (renders += 1)} />);
    const audio = getByTestId("audio") as HTMLAudioElement;
    const before = renders;
    for (const t of [0.1, 0.2, 0.3, 0.4]) {
      audio.currentTime = t;
      fireEvent(audio, new Event("timeupdate"));
    }
    expect(getByTestId("index").textContent).toBe("0");
    expect(renders - before).toBeLessThanOrEqual(1);
    audio.currentTime = 2.1;
    act(() => {
      fireEvent(audio, new Event("timeupdate"));
    });
    expect(getByTestId("index").textContent).toBe("1");
    void player;
  });

  it("says when the browser cannot play the recording", () => {
    let player!: PlayerState;
    const { getByTestId } = render(<Harness onPlayer={(p) => (player = p)} onRender={() => {}} />);
    const audio = getByTestId("audio") as HTMLAudioElement;
    Object.defineProperty(audio, "error", { value: { code: 4 }, configurable: true });
    act(() => {
      fireEvent(audio, new Event("error"));
    });
    expect(player.error).toMatch(/cannot play/);
  });
});
