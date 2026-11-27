import { useCallback, useRef, useState } from "react";

/**
 * The recording's playback state, shared by the player and the transcript:
 * the current time (ms), whether it plays, and the calls that move it.
 */
export function usePlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [timeMs, setTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  /** A seek asked for before the audio could take it. */
  const pending = useRef<number | null>(null);

  const seek = useCallback((ms: number, play = false) => {
    const a = audioRef.current;
    setTimeMs(ms);
    if (!a || a.readyState < 1) {
      pending.current = ms;
      return;
    }
    a.currentTime = Math.max(0, ms / 1000);
    if (play) void a.play().catch(() => undefined);
  }, []);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  }, []);

  const skip = useCallback((deltaMs: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(a.duration || Infinity, a.currentTime + deltaMs / 1000));
    setTimeMs(a.currentTime * 1000);
  }, []);

  const setRate = useCallback((r: number) => {
    setRateState(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
  }, []);

  /** Props for the `<audio>` element. */
  const bind = {
    ref: audioRef,
    onTimeUpdate: (e: { currentTarget: HTMLAudioElement }) => setTimeMs(e.currentTarget.currentTime * 1000),
    onLoadedMetadata: (e: { currentTarget: HTMLAudioElement }) => {
      const a = e.currentTarget;
      if (Number.isFinite(a.duration)) setDurationMs(a.duration * 1000);
      a.playbackRate = rate;
      if (pending.current !== null) {
        a.currentTime = pending.current / 1000;
        pending.current = null;
      }
    },
    onDurationChange: (e: { currentTarget: HTMLAudioElement }) => {
      const d = e.currentTarget.duration;
      if (Number.isFinite(d)) setDurationMs(d * 1000);
    },
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
  };

  return { bind, timeMs, durationMs, playing, rate, seek, toggle, skip, setRate };
}

export type PlayerState = ReturnType<typeof usePlayer>;
