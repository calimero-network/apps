/**
 * A fake call for `fake-call.spec.ts`: four people with four voices (macOS
 * `say`) follow a script. The others' voices are mixed into "the call's
 * audio" (the tab); the recorder's own voice is "the microphone", with a
 * quiet, late copy of the call in it, as laptop speakers leak into a mic
 * without headphones. A stand-in call page for each platform shows who is
 * talking the way that platform does (Meet's tiles or captions, Zoom's active
 * speaker, Teams' speaking outline), in time with the audio.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const RATE = 16_000;
export const DIR = join(import.meta.dirname, ".fake-call");

export interface Person {
  name: string;
  voice: string;
  /** The recorder: speaks into the microphone, not the call. */
  me?: boolean;
}

export const PEOPLE: Person[] = [
  { name: "Ana Horvat", voice: "Karen" },
  { name: "Marko Petrovic", voice: "Daniel" },
  { name: "Sandi Fatic", voice: "Moira" },
  { name: "Fran", voice: "Ralph", me: true },
];

export interface ScriptLine {
  who: string;
  text: string;
  /** Start this many ms before the previous line ends (people talking over each other). */
  overlapMs?: number;
}

export const SCRIPT: ScriptLine[] = [
  { who: "Ana Horvat", text: "Morning everyone. Let's go through the launch plan for the Sylence extension." },
  { who: "Marko Petrovic", text: "Sure. The store listing is ready, but we still need the screenshots." },
  { who: "Fran", text: "I can take the screenshots this afternoon." },
  { who: "Sandi Fatic", text: "Great. I tested speaker names on Zoom yesterday and they looked correct." },
  { who: "Ana Horvat", text: "Marko, can you send the deck to the design team by Friday?" },
  { who: "Marko Petrovic", text: "Yes, I will send it on Thursday evening.", overlapMs: 900 },
  { who: "Fran", text: "I'll test Brave with the shields turned on today." },
  { who: "Sandi Fatic", text: "One more thing. The privacy policy needs a final review from legal." },
  { who: "Ana Horvat", text: "Okay, I will ask legal tomorrow morning." },
  { who: "Marko Petrovic", text: "Do we ship to the public store or unlisted first?" },
  { who: "Fran", text: "Unlisted first, then public next week." },
  { who: "Sandi Fatic", text: "Sounds good to me. Thanks everyone, talk soon." },
];

/** A spoken line placed in the call. */
export interface Placed extends ScriptLine {
  startMs: number;
  endMs: number;
  me: boolean;
}

export interface Call {
  lines: Placed[];
  durationMs: number;
  /** 16 kHz mono WAV files. */
  callWav: string;
  micWav: string;
}

export function canSpeak(): boolean {
  return process.platform === "darwin" && spawnSync("say", ["-v", "?"]).status === 0;
}

function readWav(file: string): Float32Array {
  const wav = readFileSync(file);
  let at = 12;
  while (at < wav.length - 8) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    if (id === "data") {
      const n = Math.floor(size / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = wav.readInt16LE(at + 8 + i * 2) / 32768;
      return out;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}

function writeWav(file: string, samples: Float32Array): void {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([head, data]));
}

/** One line in one voice, cached by its text and voice. */
function speak(voice: string, text: string): Float32Array {
  mkdirSync(DIR, { recursive: true });
  const file = join(DIR, `${createHash("sha1").update(`${voice}\0${text}`).digest("hex").slice(0, 12)}.wav`);
  if (!existsSync(file)) {
    const r = spawnSync("say", ["-v", voice, "-o", file, "--file-format=WAVE", "--data-format=LEI16@16000", text], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`say -v ${voice} failed: ${r.stderr}`);
  }
  return readWav(file);
}

/**
 * The call: lines one after another with a short pause (or over each other),
 * the others' voices in the call's track, the recorder's in the mic's, and
 * the call leaking into the mic 180 ms late at 12% (laptop speakers).
 */
export function makeCall(gapMs = 700, leadMs = 1_500): Call {
  const voiced = SCRIPT.map((l) => {
    const p = PEOPLE.find((x) => x.name === l.who)!;
    return { ...l, me: !!p.me, audio: speak(p.voice, l.text) };
  });
  let cursor = leadMs;
  const lines: (Placed & { audio: Float32Array })[] = [];
  for (const l of voiced) {
    const startMs = l.overlapMs ? Math.max(leadMs, cursor - gapMs - l.overlapMs) : cursor;
    const endMs = startMs + Math.round((l.audio.length / RATE) * 1000);
    lines.push({ ...l, startMs, endMs });
    cursor = Math.max(cursor, endMs + gapMs);
  }
  const durationMs = cursor + 3_000;
  const n = Math.round((durationMs / 1000) * RATE);
  const call = new Float32Array(n);
  const mic = new Float32Array(n);
  for (const l of lines) {
    const at = Math.round((l.startMs / 1000) * RATE);
    const into = l.me ? mic : call;
    for (let i = 0; i < l.audio.length && at + i < n; i++) into[at + i]! += l.audio[i]! * 0.8;
  }
  const leak = Math.round(0.18 * RATE);
  let seed = 7;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    mic[i]! += (call[i - leak] ?? 0) * 0.12 + ((seed / 2 ** 31) * 2 - 1) * 0.002;
  }
  const callWav = join(DIR, "call.wav");
  const micWav = join(DIR, "mic.wav");
  writeWav(callWav, call);
  writeWav(micWav, mic);
  return { lines: lines.map(({ audio: _a, ...rest }) => rest), durationMs, callWav, micWav };
}

export type FakePlatform = "meet" | "meet-captions" | "zoom" | "teams";

export const CALL_URLS: Record<FakePlatform, { url: string; title: string }> = {
  meet: { url: "https://meet.google.com/abc-defg-hij", title: "Meet - Launch sync" },
  "meet-captions": { url: "https://meet.google.com/xyz-abcd-efg", title: "Meet - Launch sync" },
  zoom: { url: "https://app.zoom.us/wc/81234567890/join", title: "Launch sync - Zoom" },
  teams: { url: "https://teams.microsoft.com/v2/", title: "Launch sync | Microsoft Teams" },
};

/**
 * The stand-in call page. `window.__play(t0, lines)` shows each line's
 * speaker as talking from `t0 + startMs` to `t0 + endMs`, the way the
 * platform does; `t0` is when the audio started in the recorder.
 */
export function callPage(platform: FakePlatform): string {
  const people = PEOPLE.map((p) => ({ name: p.name, me: !!p.me }));
  return `<!doctype html><meta charset="utf-8"><title>${CALL_URLS[platform].title}</title>
<style>body{font:14px system-ui;background:#202124;color:#fff;display:flex;flex-wrap:wrap;gap:8px;padding:12px}
.tile{width:220px;height:130px;background:#3c4043;border-radius:8px;position:relative}
.on{outline:3px solid #8ab4f8}.bars{position:absolute;right:8px;top:8px;width:12px;height:12px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden}</style>
<body><div id="stage"></div><div id="caps" role="region" aria-label="Captions"></div>
<div id="subs" style="position:fixed;left:0;right:0;bottom:24px;text-align:center;font-size:22px;text-shadow:0 1px 3px #000"></div>
<script>
const PLATFORM = ${JSON.stringify(platform)};
const PEOPLE = ${JSON.stringify(people)};
const stage = document.getElementById("stage");
const caps = document.getElementById("caps");
const subs = document.getElementById("subs");
const tiles = {};
for (const [i, p] of PEOPLE.entries()) {
  const t = document.createElement("div");
  t.className = "tile";
  if (PLATFORM.startsWith("meet")) {
    // Meet: the name twice (shown, and for screen readers), "(You)" on your own tile.
    t.setAttribute("data-participant-id", "p" + i);
    t.innerHTML = '<div class="zWGUib">' + p.name + '<span class="sr">' + p.name + '</span></div>' + (p.me ? "<span>(You)</span>" : "") + '<div class="bars"></div>';
  } else if (PLATFORM === "zoom") {
    t.className = "tile speaker-bar-container__video-frame";
    t.innerHTML = '<div class="video-avatar__avatar-footer"><span class="video-avatar__avatar-name">' + p.name + '</span></div>';
  } else {
    t.setAttribute("data-cid", "calling-participant-stream");
    t.setAttribute("aria-label", p.name + ", video on");
    t.innerHTML = '<div data-tid="voice-level-stream-outline" class="fui-outline"></div><span>' + p.name + '</span>';
  }
  stage.appendChild(t);
  tiles[p.name] = t;
}
let active = null;
if (PLATFORM === "zoom") {
  active = document.createElement("div");
  active.className = "tile speaker-active-container__video-frame";
  active.innerHTML = '<div class="video-avatar__avatar-footer"><span class="video-avatar__avatar-name"></span></div>';
  stage.prepend(active);
}
const talking = new Set();
function show() {
  for (const p of PEOPLE) {
    const on = talking.has(p.name);
    const t = tiles[p.name];
    t.classList.toggle("on", on);
    if (PLATFORM === "teams") t.firstChild.className = on ? "fui-outline vdi-frame-occlusion" : "fui-outline";
  }
  // Zoom keeps the last active speaker in the big frame.
  if (active && talking.size) active.querySelector(".video-avatar__avatar-name").textContent = [...talking].at(-1);
}
// Meet: a talking tile's audio bars change class many times a second.
setInterval(() => {
  if (!PLATFORM.startsWith("meet")) return;
  for (const name of talking) {
    const b = tiles[name].querySelector(".bars");
    b.className = b.className === "bars" ? "bars b1" : "bars";
  }
}, 80);
window.__play = (t0, lines) => {
  for (const l of lines) {
    const startIn = t0 + l.startMs - Date.now();
    const endIn = t0 + l.endMs - Date.now();
    setTimeout(() => { talking.add(l.who); show(); subs.textContent = l.who + ": " + l.text; }, Math.max(0, startIn));
    setTimeout(() => { talking.delete(l.who); show(); if (subs.textContent.endsWith(l.text)) subs.textContent = ""; }, Math.max(0, endIn));
    if (PLATFORM === "meet-captions") {
      // Captions: the speaker's block grows word by word, then fades.
      const words = l.text.split(" ");
      let block = null;
      words.forEach((w, i) => setTimeout(() => {
        if (!block) {
          block = document.createElement("div");
          block.innerHTML = '<img alt="" src="data:,"><div class="KcIKyf">' + (l.me ? "You" : l.who) + '</div><div class="bh44bd"></div>';
          caps.appendChild(block);
        }
        block.querySelector(".bh44bd").textContent += (i ? " " : "") + w;
      }, Math.max(0, startIn + ((l.endMs - l.startMs) * i) / words.length)));
      setTimeout(() => block && block.remove(), Math.max(0, endIn + 2500));
    }
  }
};
</script>`;
}

// ── scoring ──────────────────────────────────────────────────────────────────

const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

/** How much of `line` (0–1) the saved text contains, by words. */
export function overlap(saved: string, line: string): number {
  const have = new Set(words(saved));
  const want = words(line);
  return want.length ? want.filter((w) => have.has(w)).length / want.length : 0;
}

export interface Saved {
  seq: number;
  speaker: string;
  name: string;
  startMs: number;
  text: string;
}

export interface Scored {
  saved: Saved;
  /** The script line it matches best, if any (≥ 40% of its words). */
  line: Placed | null;
  score: number;
  /** The name the transcript shows: the saved name, or You / Others. */
  shown: string;
  right: boolean;
}

export function score(saved: Saved[], lines: Placed[], me: string): { rows: Scored[]; found: Placed[]; missed: Placed[] } {
  const rows = saved.map((s) => {
    // Only lines said near this one: the times may be off by a second or two.
    const near = lines.filter((l) => s.startMs >= l.startMs - 4_000 && s.startMs <= l.endMs + 4_000);
    let best: Placed | null = null;
    let bestScore = 0;
    for (const l of near.length ? near : lines) {
      // A saved line can hold part of a script line, or two of them.
      const v = Math.max(overlap(s.text, l.text), overlap(l.text, s.text));
      if (v > bestScore) [best, bestScore] = [l, v];
    }
    const line = bestScore >= 0.4 ? best : null;
    const shown = s.name || (s.speaker === "you" ? "You" : "Others");
    const expected = line ? line.who : null;
    const right = !!expected && (shown === expected || (expected === me && (shown === "You" || shown === me)));
    return { saved: s, line, score: bestScore, shown, right };
  });
  const found = lines.filter((l) => rows.some((r) => r.line === l));
  return { rows, found, missed: lines.filter((l) => !found.includes(l)) };
}

export function report(platform: string, rows: Scored[], missed: Placed[], extra: string[]): string {
  const out = [`# Fake call on ${platform}`, "", ...extra, "", "| # | said by (script) | shown as | ok | text |", "|---|---|---|---|---|"];
  for (const r of rows) {
    out.push(`| ${r.saved.seq} | ${r.line?.who ?? "—"} | ${r.shown} | ${r.line ? (r.right ? "✓" : "✗") : "?"} | ${r.saved.text.replace(/\|/g, "/")} |`);
  }
  if (missed.length) out.push("", "Not in the transcript:", ...missed.map((m) => `- ${m.who}: ${m.text}`));
  return out.join("\n");
}
