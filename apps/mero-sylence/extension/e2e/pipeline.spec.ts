/**
 * Opt-in (SYLENCE_E2E_MODEL=1; downloads Moonshine tiny, ~28 MB): the whole
 * recording pipeline in the built extension's own offscreen page, with only
 * the tab's stream replaced (Chrome hands a real one out after a toolbar click,
 * which automation can't make). A sentence plays as "the tab" at 48 kHz; the
 * real AudioWorklet, resampler, segmenter, scheduler and speech worker turn it
 * into a segment event, which the service worker receives; Stop drains it.
 */
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dist = join(import.meta.dirname, "..", "dist");
const ID = readFileSync(join(import.meta.dirname, "..", "extension-id.txt"), "utf8").trim();

function speech(): number[] {
  const wav = readFileSync(join(import.meta.dirname, "fixtures", "speech-16k.wav"));
  let at = 12;
  while (at < wav.length - 8) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    if (id === "data") {
      const out: number[] = [];
      for (let i = at + 8; i + 1 < at + 8 + size; i += 2) out.push(wav.readInt16LE(i) / 32768);
      return out;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

let context: BrowserContext;

test.beforeAll(async () => {
  test.skip(!process.env.SYLENCE_E2E_MODEL, "set SYLENCE_E2E_MODEL=1 to download a model");
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "sylence-pipeline-")), {
    channel: "chromium",
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--autoplay-policy=no-user-gesture-required"],
  });
  // The tutorial opens by itself on a first sign-in; these runs are past it.
  await context.addInitScript(() => localStorage.setItem("mero-sylence:tutorial-seen", "1"));
});
test.afterAll(async () => {
  await context?.close();
});

test("a sentence played into the offscreen page comes out as a transcript segment", async () => {
  test.setTimeout(300_000);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  expect(new URL(worker.url()).host).toBe(ID);

  // The offscreen page, opened as a tab, with getUserMedia answering the
  // "tab" request with the sentence (1 s of quiet, the sentence, 4 s of quiet).
  const offscreen = await context.newPage();
  await offscreen.addInitScript((samples: number[]) => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
      if (!JSON.stringify(c?.audio ?? "").includes("chromeMediaSource")) return real(c);
      const ctx = new AudioContext({ sampleRate: 48_000 });
      const buffer = ctx.createBuffer(1, 16_000 * 7 + samples.length, 16_000);
      buffer.getChannelData(0).set(Float32Array.from(samples), 16_000);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const out = ctx.createMediaStreamDestination();
      src.connect(out);
      await ctx.resume();
      src.start();
      (window as unknown as { __playEnds: number }).__playEnds = Date.now() + buffer.duration * 1000;
      return out.stream;
    };
  }, speech());
  await offscreen.goto(`chrome-extension://${ID}/offscreen.html`);

  // Another extension page sends the service worker's commands and hears every event.
  const control = await context.newPage();
  await control.goto(`chrome-extension://${ID}/popup.html`);
  await control.evaluate(() => {
    const w = window as unknown as { __events: Record<string, unknown>[] };
    w.__events = [];
    chrome.runtime.onMessage.addListener((m: Record<string, unknown>) => {
      if (m.source === "offscreen" && m.type !== "levels") w.__events.push(m);
    });
  });
  const captured = await control.evaluate(() =>
    chrome.runtime.sendMessage({ target: "offscreen", type: "capture", streamId: "fake", mic: false, tier: "ultralight", language: "en" }),
  );
  expect(captured).toBe(true);

  // Let the sentence play out, then press Stop.
  const playEnds = await offscreen.evaluate(() => (window as unknown as { __playEnds: number }).__playEnds);
  await control.waitForTimeout(Math.max(0, playEnds - Date.now()) + 500);
  await control.evaluate(() => chrome.runtime.sendMessage({ target: "offscreen", type: "stop" }));

  const types = () => control.evaluate(() => (window as unknown as { __events: { type: string }[] }).__events.map((e) => e.type));
  await expect.poll(types, { timeout: 240_000, intervals: [1_000] }).toContain("drained");
  const all = await control.evaluate(() => (window as unknown as { __events: Record<string, unknown>[] }).__events);
  const errors = all.filter((e) => e.type === "captureError" || (e.type === "model" && e.state === "error"));
  expect(errors).toEqual([]);
  const segments = all.filter((e) => e.type === "segment");
  const text = segments.map((s) => String(s.text)).join(" ").toLowerCase();
  console.log(`pipeline: ${segments.length} segment(s): ${JSON.stringify(text)}`);
  expect(text).toMatch(/deck/);
  expect(text).toMatch(/friday/);
  for (const s of segments) {
    expect(s.speaker).toBe("others");
    // The sentence starts 1 s into "the tab".
    expect(Number(s.startMs)).toBeGreaterThanOrEqual(500);
    expect(Number(s.endMs)).toBeGreaterThan(Number(s.startMs));
  }
  // Segments come before drained, so the service worker queues them first.
  const order = all.map((e) => e.type).filter((t) => t === "segment" || t === "drained");
  expect(order.at(-1)).toBe("drained");
  expect(order.indexOf("drained")).toBe(order.length - 1);
  // The service worker heard them too (its diagnostics log names each one).
  const log = await control.evaluate(async () => ((await chrome.storage.session.get("sylence:log"))["sylence:log"] ?? []) as string[]);
  expect(log.some((l) => l.includes("segment: others"))).toBe(true);
  expect(log.some((l) => l.includes("drained:"))).toBe(true);
});
