/**
 * Synthesised sound — no samples shipped. Thumps and cracks from filtered
 * noise, a whoosh for a swing, and the announcer through speech synthesis.
 */
const MUTE_KEY = "mero-kombat:muted";

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean) {
  muted = next;
  try {
    window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    /* a forgotten preference is fine */
  }
  if (next) window.speechSynthesis?.cancel();
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    if (!noise) {
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    return ctx;
  } catch {
    return null;
  }
}

function burst(freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = "bandpass") {
  const a = audio();
  if (!a || !noise) return;
  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start();
  src.stop(a.currentTime + dur);
}

function tone(type: OscillatorType, from: number, to: number, dur: number, gain: number) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), a.currentTime + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}

export const sfx = {
  swing() {
    burst(1800, 0.8, 0.12, 0.12, "highpass");
  },
  hit(heavy: boolean) {
    tone("sine", heavy ? 140 : 180, 40, heavy ? 0.25 : 0.16, 0.5);
    burst(heavy ? 900 : 1400, 1.2, heavy ? 0.18 : 0.1, 0.45);
  },
  block() {
    tone("square", 900, 600, 0.06, 0.08);
    burst(3000, 3, 0.05, 0.15);
  },
  jump() {
    burst(600, 1, 0.08, 0.06, "lowpass");
  },
  land() {
    tone("sine", 90, 40, 0.1, 0.25);
  },
  special() {
    tone("sawtooth", 220, 880, 0.3, 0.07);
    burst(2400, 1, 0.25, 0.1);
  },
  ko() {
    tone("sine", 70, 25, 0.9, 0.7);
    burst(300, 0.6, 0.6, 0.35, "lowpass");
  },
};

/** The announcer. Deep, slow, and entirely optional. */
export function announce(text: string) {
  if (muted) return;
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.pitch = 0.3;
    u.rate = 0.85;
    u.volume = 0.9;
    synth.speak(u);
  } catch {
    /* no voice is fine */
  }
}
