import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { activeIndex } from "./lib/playback";
import type { SegmentView } from "./generated/client";

/**
 * The recording's playback state, shared by the player and the transcript.
 *
 * The current time changes about four times a second while playing, so it is
 * not React state: it lives in a small store. The player bar reads it with
 * `usePlayerTime`; the transcript reads only the playing line's index
 * (`usePlayingIndex`), which re-renders it once per line, not once per tick.
 */
export function usePlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const time = useRef(0);
  const listeners = useRef(new Set<() => void>());
  const [durationMs, setDurationMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  const [error, setError] = useState<string | null>(null);
  /** A seek asked for before the audio could take it, and whether to play after it. */
  const pending = useRef<{ ms: number; play: boolean } | null>(null);
  const rateRef = useRef(1);

  const setTime = useCallback((ms: number) => {
    if (ms === time.current) return;
    time.current = ms;
    for (const fn of listeners.current) fn();
  }, []);
  const subscribe = useCallback((fn: () => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);
  const getTime = useCallback(() => time.current, []);

  const seek = useCallback(
    (ms: number, play = false) => {
      const a = audioRef.current;
      setTime(Math.max(0, ms));
      if (!a || a.readyState < 1) {
        pending.current = { ms, play };
        return;
      }
      a.currentTime = Math.max(0, ms / 1000);
      if (play) void a.play().catch(() => undefined);
    },
    [setTime],
  );

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  }, []);

  const skip = useCallback(
    (deltaMs: number) => {
      const a = audioRef.current;
      if (!a) return;
      a.currentTime = Math.max(0, Math.min(a.duration || Infinity, a.currentTime + deltaMs / 1000));
      setTime(a.currentTime * 1000);
    },
    [setTime],
  );

  const setRate = useCallback((r: number) => {
    rateRef.current = r;
    setRateState(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
  }, []);

  /** Props for the `<audio>` element. */
  const bind = useMemo(
    () => ({
      ref: audioRef,
      onTimeUpdate: (e: { currentTarget: HTMLAudioElement }) => setTime(e.currentTarget.currentTime * 1000),
      onSeeked: (e: { currentTarget: HTMLAudioElement }) => setTime(e.currentTarget.currentTime * 1000),
      onLoadedMetadata: (e: { currentTarget: HTMLAudioElement }) => {
        const a = e.currentTarget;
        if (Number.isFinite(a.duration)) setDurationMs(a.duration * 1000);
        a.playbackRate = rateRef.current;
        setError(null);
        const p = pending.current;
        pending.current = null;
        if (p) {
          a.currentTime = p.ms / 1000;
          if (p.play) void a.play().catch(() => undefined);
        }
      },
      onDurationChange: (e: { currentTarget: HTMLAudioElement }) => {
        const d = e.currentTarget.duration;
        if (Number.isFinite(d)) setDurationMs(d * 1000);
      },
      onError: (e: { currentTarget: HTMLAudioElement }) => {
        const code = e.currentTarget.error?.code;
        setPlaying(false);
        setError(
          code === 4
            ? "this browser cannot play this recording's format"
            : code === 2
              ? "the network stopped while reading it"
              : "the browser could not play it",
        );
      },
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
      onEnded: () => setPlaying(false),
    }),
    [setTime],
  );

  return useMemo(
    () => ({ bind, subscribe, getTime, durationMs, playing, rate, error, seek, toggle, skip, setRate }),
    [bind, subscribe, getTime, durationMs, playing, rate, error, seek, toggle, skip, setRate],
  );
}

export type PlayerState = ReturnType<typeof usePlayer>;

/** The current time, ms; re-renders the caller on every tick. Only the player bar should use it. */
export function usePlayerTime(player: Pick<PlayerState, "subscribe" | "getTime">): number {
  return useSyncExternalStore(player.subscribe, player.getTime, player.getTime);
}

/** The index in `byStart` of the line being said; re-renders the caller only when it changes. */
export function usePlayingIndex(
  player: Pick<PlayerState, "subscribe" | "getTime">,
  byStart: readonly Pick<SegmentView, "startMs" | "endMs">[],
  enabled: boolean,
): number {
  const snapshot = useCallback(() => (enabled ? activeIndex(byStart, player.getTime()) : -1), [enabled, byStart, player]);
  return useSyncExternalStore(player.subscribe, snapshot, snapshot);
}
