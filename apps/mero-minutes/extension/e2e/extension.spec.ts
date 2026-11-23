/**
 * Loads dist/ as an unpacked extension (Chromium's new headless mode runs
 * extensions) and checks what can be checked without a call or an account:
 * the service worker starts under the pinned id, the popup renders its
 * signed-out screen, the side panel and microphone pages render.
 */
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dist = join(import.meta.dirname, "..", "dist");
const ID = readFileSync(join(import.meta.dirname, "..", "extension-id.txt"), "utf8").trim();

let context: BrowserContext;

/** The fixture's samples as floats: a WAVE file's `data` chunk, 16-bit little-endian. */
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

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "minutes-e2e-")), {
    channel: "chromium",
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
});
test.afterAll(async () => {
  await context.close();
});

test("the service worker runs under the pinned extension id", async () => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  expect(new URL(worker.url()).host).toBe(ID);
  expect(new URL(worker.url()).pathname).toBe("/background.js");
});

test("the popup opens signed out, with no console errors", async () => {
  const errors: string[] = [];
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`chrome-extension://${ID}/popup.html`);
  await expect(page.getByRole("button", { name: "Sign in with Calimero" })).toBeVisible();
  await expect(page.getByText(/Audio is never uploaded/)).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Speech model")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the side panel and the microphone page render", async () => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${ID}/sidepanel.html`);
  await expect(panel.getByText(/Start a recording/)).toBeVisible();
  const mic = await context.newPage();
  await mic.goto(`chrome-extension://${ID}/permission.html`);
  await expect(mic.getByRole("button", { name: "Allow microphone" })).toBeVisible();
});

test("the extension pages are cross-origin isolated (threads for the model)", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${ID}/popup.html`);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
});

/**
 * Opt-in (MINUTES_E2E_MODEL=1; downloads Moonshine tiny, ~28 MB): the speech
 * worker loads the bundled ONNX runtime under the extension's CSP, fetches a
 * model from Hugging Face and transcribes.
 * A sentence spoken by macOS `say` (e2e/fixtures/speech-16k.wav, 16 kHz mono
 * 16-bit) must come back as its words.
 */
/** MINUTES_E2E_MODEL=1 tries Moonshine tiny; a comma list names tiers (ultralight,light,balanced). */
const MODEL_TIERS = (process.env.MINUTES_E2E_MODEL ?? "")
  .split(",")
  .map((t) => (t.trim() === "1" ? "ultralight" : t.trim()))
  .filter(Boolean);

for (const tier of MODEL_TIERS.length ? MODEL_TIERS : ["ultralight"]) {
  test(`the speech worker loads ${tier} and transcribes`, async () => {
    test.skip(!process.env.MINUTES_E2E_MODEL, "set MINUTES_E2E_MODEL=1 to download a model");
    test.setTimeout(240_000);
    const { readdirSync } = await import("node:fs");
    const worker = readdirSync(join(dist, "assets")).find((f) => /^worker-.*\.js$/.test(f));
    expect(worker).toBeTruthy();
    const page = await context.newPage();
    await page.goto(`chrome-extension://${ID}/popup.html`);
    const result = await page.evaluate(async ({ file, samples, tier }) => {
      const w = new Worker(`/assets/${file}`, { type: "module" });
      const events: string[] = [];
      const wait = (type: string) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          w.addEventListener("message", (e: MessageEvent<Record<string, unknown>>) => {
            events.push(String(e.data.type));
            if (e.data.type === type) resolve(e.data);
            if (e.data.type === "loadError" || e.data.type === "transcribeError") reject(new Error(String(e.data.error)));
          });
        });
      const ready = wait("ready");
      w.postMessage({ type: "load", tier });
      const r = await ready;
      const audio = Float32Array.from(samples);
      const text = wait("text");
      w.postMessage({ type: "transcribe", id: 1, audio, language: "en" }, [audio.buffer]);
      const t = await text;
      return { device: r.device, ms: t.ms, text: t.text, sawProgress: events.includes("progress") };
    }, { file: worker!, samples: speech(), tier });
    expect(result.device).toBe("wasm");
    expect(result.sawProgress).toBe(true);
    console.log(`${tier}: transcribed ${(speech().length / 16_000).toFixed(1)} s in ${Math.round(Number(result.ms))} ms: ${JSON.stringify(result.text)}`);
    expect(String(result.text).toLowerCase()).toMatch(/deck/);
    expect(String(result.text).toLowerCase()).toMatch(/friday/);
  });
}
