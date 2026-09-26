import { test, type CDPSession, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getNode, loginViaHash } from '../helpers';

/**
 * Records the landing page's two clips from the real app, against a real merod
 * node with the real contract installed (the e2e global setup):
 *
 *   pnpm landing:media   → public/landing/demo.webm + demo-poster.jpg (the story)
 *                          public/landing/hero.webm + hero-poster.jpg (the hero loop)
 *
 * Everything on screen is the node's own state: the workbook is seeded through
 * the contract, you type through the UI, and formulas recompute in the app's
 * recalc engine. The one stand-in is the teammate, Ada. A second member needs a
 * second node, whose sync timing would shift the chapters from run to run, so
 * Ada lives on the same node: her edits are real `set_cell` writes
 * to it (arriving over the node's real event stream), her name is added to the
 * node's `get_members` reply, and her cursor is a presence slice injected into
 * that same event stream, exactly as a peer's arrives.
 *
 * The story's chapters are padded to fixed lengths, so the chapter times in
 * scripts/landing/apps.config.mjs stay right on every re-run.
 */
const CHAPTERS = [
  { id: 'open', seconds: 3 },
  { id: 'type', seconds: 5 },
  { id: 'formula', seconds: 6.5 },
  { id: 'live', seconds: 5.5 },
] as const;

const OUT = process.env.MEDIA_OUT ?? 'public/landing';
const FFMPEG = process.env.FFMPEG ?? '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';
const FPS = 25;

const ADA = { id: 'Ada-teammate', nickname: 'Ada' };

/** A Q3 budget: labels, three quarters, and totals that are real formulas. */
const BUDGET: [number, number, string][] = [];
const rows = [
  ['Item', 'Q1', 'Q2', 'Q3', 'Total'],
  ['Wages', '42000', '43500', '44000', '=SUM(B2:D2)'],
  ['Rent', '6000', '6000', '6000', '=SUM(B3:D3)'],
  ['Cloud', '2400', '2650', '2900', '=SUM(B4:D4)'],
  ['Travel', '1200', '', '1500', '=SUM(B5:D5)'],
  ['Marketing', '3000', '3500', '4000', '=SUM(B6:D6)'],
  ['Total', '=SUM(B2:B6)', '=SUM(C2:C6)', '=SUM(D2:D6)', '=SUM(E2:E6)'],
  ['Average', '', '', '', ''],
];
rows.forEach((r, row) => r.forEach((v, col) => { if (v) BUDGET.push([row, col, v]); }));

/**
 * Chrome's screencast at 2x, not Playwright's `recordVideo`, which encodes at 1x
 * and a low fixed bitrate. Frames arrive only on repaint, so each is held until
 * the next when the clip is laid out at a constant rate.
 */
class Recorder {
  private frames: { t: number; jpeg: Buffer }[] = [];
  private constructor(private cdp: CDPSession) {}

  static async start(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    const rec = new Recorder(cdp);
    cdp.on('Page.screencastFrame', (f) => {
      rec.frames.push({ t: f.metadata.timestamp ?? Date.now() / 1000, jpeg: Buffer.from(f.data, 'base64') });
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
    return rec;
  }

  now() {
    return this.frames.length ? Date.now() / 1000 - this.frames[0].t : 0;
  }

  async stop() {
    await this.cdp.send('Page.stopScreencast');
  }

  async encode(path: string, from: number, seconds: number, width: number) {
    if (!existsSync(FFMPEG)) throw new Error(`no ffmpeg at ${FFMPEG}; set FFMPEG`);
    const t0 = this.frames[0].t + from;
    const ff = spawn(FFMPEG, [
      '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0',
      '-vf', `scale=${width}:-2`, '-an',
      '-c:v', 'libvpx', '-b:v', '2400k', '-crf', '6', '-qmin', '2', '-qmax', '30',
      '-deadline', 'good', '-cpu-used', '1', '-auto-alt-ref', '0', '-g', String(FPS * 4),
      path,
    ]);
    let err = '';
    ff.stderr.on('data', (d) => { err += d; });
    const done = new Promise<void>((ok, fail) =>
      ff.on('close', (code) => (code === 0 ? ok() : fail(new Error(err.slice(-2000))))),
    );
    let i = 0;
    for (let n = 0; n < Math.round(seconds * FPS); n++) {
      const t = t0 + n / FPS;
      while (i + 1 < this.frames.length && this.frames[i + 1].t <= t) i++;
      if (!ff.stdin.write(this.frames[i].jpeg)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await done;
  }
}

/** Recordings do not include the OS pointer, so draw one that follows the mouse. */
async function showPointer(page: Page) {
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 2.5l6.5 18 2.4-7.4 7.6-2.6z" ' +
        'fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      const dot = document.createElement('div');
      dot.style.cssText =
        'position:fixed;left:-40px;top:-40px;width:24px;height:24px;margin:-3px 0 0 -4px;z-index:2147483647;' +
        'pointer-events:none;transition:transform .12s ease-out;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4));' +
        `background:no-repeat center/contain url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
      document.body.appendChild(dot);
      window.addEventListener('mousemove', (e) => {
        dot.style.left = `${e.clientX}px`;
        dot.style.top = `${e.clientY}px`;
      }, true);
      window.addEventListener('mousedown', () => { dot.style.transform = 'scale(.82)'; }, true);
      window.addEventListener('mouseup', () => { dot.style.transform = ''; }, true);
    });
  });
}

/**
 * Passes the node's real `/sse` stream through untouched, and lets the test add
 * frames to it (`window.__sse`) between the node's own. Installed before the
 * app loads, so mero-js reads the tapped stream as the node's.
 */
async function tapEventStream(page: Page) {
  await page.addInitScript(() => {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    // Every open stream: React's dev double-mount opens two. A frame is only
    // injected at a frame boundary, never inside a half-arrived node frame.
    const taps = new Map<ReadableStreamDefaultController<Uint8Array>, { atBoundary: boolean; queued: Uint8Array[] }>();
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const res = await realFetch(input, init);
      if (!/\/sse$/.test(url) || !res.body) return res;
      const reader = res.body.getReader();
      let self: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          self = c;
          const tap = { atBoundary: true, queued: [] as Uint8Array[] };
          taps.set(c, tap);
          void (async () => {
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                c.enqueue(value);
                tap.atBoundary = dec.decode(value.slice(-2)) === '\n\n';
                if (tap.atBoundary) for (const q of tap.queued.splice(0)) c.enqueue(q);
              }
              c.close();
            } catch {
              /* the page went away */
            } finally {
              taps.delete(c);
            }
          })();
        },
        cancel() {
          taps.delete(self);
          void reader.cancel();
        },
      });
      return new Response(body, { status: res.status, headers: res.headers });
    };
    (window as unknown as { __sse: (m: unknown) => void }).__sse = (m) => {
      const bytes = enc.encode(`data: ${JSON.stringify(m)}\n\n`);
      for (const [c, tap] of taps) {
        try {
          if (tap.atBoundary) c.enqueue(bytes);
          else tap.queued.push(bytes);
        } catch {
          taps.delete(c);
        }
      }
    };
  });
}

/** The workbook this page opened, read off the app's own RPC traffic. */
class Workbook {
  contextId = '';
  sheetId = '';
  /** Where Ada's cursor sits; null keeps her off the sheet. */
  ada: { row: number; col: number } | null = null;
  constructor(private page: Page) {}

  async attach() {
    const node = getNode(0);
    await tapEventStream(this.page);
    await this.page.route('**/jsonrpc', async (route) => {
      const body = route.request().postDataJSON() as { params?: { contextId?: string; method?: string } };
      const method = body?.params?.method;
      if (body?.params?.contextId) this.contextId = body.params.contextId;
      if (method !== 'get_members' && method !== 'list_sheets') return route.fallback();
      const res = await route.fetch();
      const json = await res.json();
      const out = json?.result?.output;
      if (method === 'list_sheets' && Array.isArray(out) && out[0]?.id && !this.sheetId) this.sheetId = out[0].id;
      if (method === 'get_members' && Array.isArray(out)) {
        out.push({ id: ADA.id, nickname: ADA.nickname, joined_at: 1, updated_at: 1 });
      }
      return route.fulfill({ response: res, json });
    });
    return node;
  }

  /** One contract call on the node, as the node's own identity. */
  async call(method: string, argsJson: Record<string, unknown>) {
    const node = getNode(0);
    const res = await fetch(`${node.adminUrl}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${node.accessToken}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'execute', params: { contextId: this.contextId, method, argsJson } }),
    });
    const json = await res.json();
    if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
    return json.result?.output;
  }

  async setCell(row: number, col: number, raw_value: string) {
    // A fresh workbook has the legacy layout, where a row's id is its position.
    await this.call('set_cell', { sheet_id: this.sheetId, row_id: String(row), col_id: String(col), raw_value });
  }

  private beat = 0;

  /** Publishes Ada's cursor as the presence slice a peer's node would relay. */
  async sendAda() {
    const slice = this.ada
      ? { d: ADA.id, s: this.sheetId, r: this.ada.row, c: this.ada.col, g: null, n: this.beat++ }
      : {};
    const state = Array.from(new TextEncoder().encode(JSON.stringify(slice)));
    await this.page.evaluate(
      (m) => (window as unknown as { __sse: (m: unknown) => void }).__sse(m),
      { result: { contextId: this.contextId, type: 'Ephemeral', data: { author: 'ada-presence', state } } },
    );
  }

  /** Moves Ada one cell at a time. */
  async moveAda(path: [number, number][], stepMs = 380) {
    for (const [row, col] of path) {
      this.ada = { row, col };
      await this.sendAda();
      await this.page.waitForTimeout(stepMs);
    }
  }
}

/**
 * Logs in, creates the budget workbook through the UI, and seeds it through the
 * contract. At full size: the start screen lists every workbook already on the
 * node, and at hero size that list pushes Create out of reach.
 */
async function openBudget(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await showPointer(page);
  const wb = new Workbook(page);
  await wb.attach();
  await loginViaHash(page, 0);
  await page.getByTestId('field-name').fill('Q3 Budget');
  await page.getByTestId('action-init_project').click();
  const nick = page.getByTestId('field-nickname');
  await nick.waitFor({ timeout: 20_000 });
  await nick.fill('Sam');
  await nick.press('Enter');
  await page.getByTestId('item-cell').first().waitFor();
  await page.waitForTimeout(800);
  if (!wb.contextId || !wb.sheetId) throw new Error('did not see the workbook on the wire');
  for (const [row, col, v] of BUDGET) await wb.setCell(row, col, v);
  await page.waitForTimeout(1500);
  return wb;
}

const cell = (page: Page, row: number, col: number) => page.locator(`[data-testid="item-cell"][data-row="${row}"][data-col="${col}"]`);

async function glideTo(page: Page, row: number, col: number, steps = 14) {
  const b = (await cell(page, row, col).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps });
}

test('demo video', async ({ page }) => {
  const wb = await openBudget(page);
  // At 2x: sharp text, and still the app's own layout at 1280.
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
  wb.ada = { row: 3, col: 3 };
  await wb.sendAda();
  await page.mouse.move(700, 600);
  await page.waitForTimeout(1200);

  const rec = await Recorder.start(page);
  await page.waitForTimeout(300);
  const clipStart = rec.now();
  let chapterEnd = clipStart;
  const chapter = async (i: number, body: () => Promise<void>) => {
    chapterEnd += CHAPTERS[i].seconds;
    await body();
    const left = chapterEnd - rec.now();
    if (left < 0) throw new Error(`chapter ${CHAPTERS[i].id} overran by ${(-left).toFixed(2)}s`);
    await page.waitForTimeout(left * 1000);
  };

  // 1. Open a workbook: the budget, and Ada already in it.
  await chapter(0, async () => {
    await wb.moveAda([[3, 2], [3, 3]], 600);
  });

  // 2. Type a number; the totals that read it recompute.
  await chapter(1, async () => {
    await glideTo(page, 4, 2);
    await cell(page, 4, 2).click();
    await page.keyboard.type('1800', { delay: 110 });
    await page.keyboard.press('Enter');
  });

  // 3. Write a formula, with autocomplete.
  await chapter(2, async () => {
    await glideTo(page, 7, 1);
    await cell(page, 7, 1).click();
    await page.keyboard.type('=AV', { delay: 140 });
    await page.waitForTimeout(700);
    await page.keyboard.type('ERAGE(B2:B6)', { delay: 70 });
    await page.keyboard.press('Enter');
  });

  // 4. Ada edits, live: her cursor walks up to Wages Q3 and her number lands.
  await chapter(3, async () => {
    await page.mouse.move(760, 640, { steps: 10 });
    await wb.moveAda([[2, 3], [1, 3]]);
    await page.waitForTimeout(300);
    await wb.setCell(1, 3, '46500');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/demo-poster.jpg`, type: 'jpeg', quality: 82 });
  });

  await rec.stop();
  await rec.encode(`${OUT}/demo.webm`, clipStart, CHAPTERS.reduce((s, c) => s + c.seconds, 0), 1600);
});

/**
 * The hero loop: two people in one workbook at the same moment. Recorded at the
 * hero stage's ratio (495 x 341), which is what `animation.tsx` plays it in —
 * and narrow, at 3x, so the budget fills the frame instead of its top-left
 * corner and its numbers still read at hero size.
 */
test('hero video', async ({ page }) => {
  const wb = await openBudget(page);
  const size = { width: Number(process.env.HERO_W ?? 740), height: Math.round(Number(process.env.HERO_W ?? 740) / 1.4516) };
  await page.setViewportSize(size);
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 3, mobile: false });
  wb.ada = { row: 5, col: 3 };
  await wb.sendAda();
  await page.mouse.move(size.width - 120, size.height - 80);
  await page.waitForTimeout(1200);

  const rec = await Recorder.start(page);
  await page.waitForTimeout(300);
  const start = rec.now();
  // You fill in Travel Q2 while Ada walks up to Wages Q3 and changes it.
  await Promise.all([
    (async () => {
      await glideTo(page, 4, 2, 18);
      await cell(page, 4, 2).click();
      await page.keyboard.type('1800', { delay: 120 });
      await page.keyboard.press('Enter');
    })(),
    (async () => {
      await wb.moveAda([[4, 3], [3, 3], [2, 3], [1, 3]], 420);
      await wb.setCell(1, 3, '46500');
    })(),
  ]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/hero-poster.jpg`, type: 'jpeg', quality: 82 });
  await page.waitForTimeout(1500);
  await rec.stop();
  await rec.encode(`${OUT}/hero.webm`, start, rec.now() - start - 0.1, 1200);
});
