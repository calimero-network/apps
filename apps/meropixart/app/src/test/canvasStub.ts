// ── A canvas 2D stub for the unit suite ──────────────────────────────────────
//
// jsdom ships no 2D context, and the `canvas` npm package is a native build we
// do not want in CI. Without *something*, every module that touches pixels — the
// compositor, the raster helpers, the showcase renderer — is untestable outside a
// browser, which is exactly where the interesting logic lives.
//
// So this stub implements the subset of CanvasRenderingContext2D the app calls,
// with two properties that make it useful rather than merely quiet:
//
//   1. a REAL pixel buffer behind getImageData / putImageData / createImageData,
//      so LUT code (curves, levels, filters) and flood fill run their actual
//      arithmetic and can be asserted on;
//   2. a call RECORD with the live transform matrix, alpha, blend mode and filter
//      captured per drawImage, so the compositor's decisions (order, inherited
//      opacity, blend mapping, per-layer transform) are assertable without pixels.
//
// What it does NOT do: rasterise shapes or text. A `fillRect` does not tint the
// buffer. Tests must therefore assert on the record or on data they put into the
// buffer themselves — never on "did drawing this rectangle make the middle pixel
// red". Pixel-accurate rendering is checked in the Playwright suite, in a real
// browser, where it is actually true.

export interface DrawCall {
  kind: "drawImage" | "fillRect" | "clearRect" | "fillText" | "stroke" | "fill" | "putImageData";
  args: number[];
  /** live transform at the time of the call, as [a,b,c,d,e,f] */
  transform: number[];
  globalAlpha: number;
  globalCompositeOperation: string;
  filter: string;
  fillStyle: string;
  /** for drawImage: the source canvas, when it was one */
  source?: HTMLCanvasElement;
}

export interface StubContextExtras {
  __record: DrawCall[];
  __pixels: Uint8ClampedArray;
}

type Matrix = [number, number, number, number, number, number];

const IDENT: Matrix = [1, 0, 0, 1, 0, 0];

function mul(m: Matrix, n: Matrix): Matrix {
  // n applied after m, matching canvas semantics for ctx.transform()
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

class StubImageData {
  readonly data: Uint8ClampedArray;
  constructor(public width: number, public height: number, data?: Uint8ClampedArray) {
    this.data = data ?? new Uint8ClampedArray(width * height * 4);
  }
}

class StubPath2D {
  /** Recorded subpath points, so geometry code can be asserted on. */
  readonly ops: Array<{ op: string; args: number[] }> = [];
  constructor(public readonly d?: string) {}
  moveTo(...args: number[]) { this.ops.push({ op: "moveTo", args }); }
  lineTo(...args: number[]) { this.ops.push({ op: "lineTo", args }); }
  rect(...args: number[]) { this.ops.push({ op: "rect", args }); }
  ellipse(...args: number[]) { this.ops.push({ op: "ellipse", args }); }
  arc(...args: number[]) { this.ops.push({ op: "arc", args }); }
  arcTo(...args: number[]) { this.ops.push({ op: "arcTo", args }); }
  quadraticCurveTo(...args: number[]) { this.ops.push({ op: "quadraticCurveTo", args }); }
  bezierCurveTo(...args: number[]) { this.ops.push({ op: "bezierCurveTo", args }); }
  closePath() { this.ops.push({ op: "closePath", args: [] }); }
  addPath() { /* unused */ }
}

class StubGradient {
  readonly stops: Array<[number, string]> = [];
  addColorStop(offset: number, color: string) { this.stops.push([offset, color]); }
}

function makeContext(canvas: HTMLCanvasElement) {
  let transform: Matrix = [...IDENT] as Matrix;
  const stack: Array<{
    transform: Matrix; globalAlpha: number; gco: string; filter: string;
    fillStyle: string; strokeStyle: string; lineWidth: number;
  }> = [];
  const record: DrawCall[] = [];
  let pixels = new Uint8ClampedArray(Math.max(1, canvas.width) * Math.max(1, canvas.height) * 4);

  const ctx = {
    canvas,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "none",
    fillStyle: "#000000" as string | StubGradient,
    strokeStyle: "#000000" as string | StubGradient,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    letterSpacing: "0px",
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "low",
    shadowBlur: 0,
    shadowColor: "transparent",
    shadowOffsetX: 0,
    shadowOffsetY: 0,

    __record: record,
    get __pixels() { return pixels; },

    save() {
      stack.push({
        transform: [...transform] as Matrix,
        globalAlpha: ctx.globalAlpha,
        gco: ctx.globalCompositeOperation,
        filter: ctx.filter,
        fillStyle: String(ctx.fillStyle),
        strokeStyle: String(ctx.strokeStyle),
        lineWidth: ctx.lineWidth,
      });
    },
    restore() {
      const prev = stack.pop();
      if (!prev) return;
      transform = prev.transform;
      ctx.globalAlpha = prev.globalAlpha;
      ctx.globalCompositeOperation = prev.gco;
      ctx.filter = prev.filter;
      ctx.fillStyle = prev.fillStyle;
      ctx.strokeStyle = prev.strokeStyle;
      ctx.lineWidth = prev.lineWidth;
    },

    setTransform(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) { transform = [a, b, c, d, e, f]; },
    resetTransform() { transform = [...IDENT] as Matrix; },
    getTransform() {
      const [a, b, c, d, e, f] = transform;
      return { a, b, c, d, e, f };
    },
    transform(a: number, b: number, c: number, d: number, e: number, f: number) {
      transform = mul(transform, [a, b, c, d, e, f]);
    },
    translate(x: number, y: number) { transform = mul(transform, [1, 0, 0, 1, x, y]); },
    scale(x: number, y: number) { transform = mul(transform, [x, 0, 0, y, 0, 0]); },
    rotate(rad: number) {
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      transform = mul(transform, [cos, sin, -sin, cos, 0, 0]);
    },

    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, rect() {},
    arc() {}, arcTo() {}, ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    clip() {}, setLineDash() {}, getLineDash() { return []; },
    lineDashOffset: 0,

    fill(...args: unknown[]) { push("fill", args.filter((a) => typeof a === "number") as number[]); },
    stroke(...args: unknown[]) { push("stroke", args.filter((a) => typeof a === "number") as number[]); },
    fillRect(...args: number[]) { push("fillRect", args); },
    strokeRect() {},
    clearRect(...args: number[]) { push("clearRect", args); },
    fillText(text: string, x: number, y: number) { push("fillText", [x, y, text.length]); },
    strokeText() {},

    measureText(text: string) {
      // A believable monospace-ish advance, derived from the font size in `font`
      // so text-fitting code (renderTextLayer, the inline editor) can be tested.
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
      return { width: text.length * size * 0.55, actualBoundingBoxAscent: size * 0.8 };
    },

    createLinearGradient() { return new StubGradient(); },
    createRadialGradient() { return new StubGradient(); },
    createPattern() { return null; },

    createImageData(w: number, h: number) { return new StubImageData(w, h); },
    getImageData(x: number, y: number, w: number, h: number) {
      const out = new StubImageData(w, h);
      const cw = canvas.width;
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const sx = x + col;
          const sy = y + row;
          const si = (sy * cw + sx) * 4;
          const di = (row * w + col) * 4;
          if (sx < 0 || sy < 0 || sx >= cw || sy >= canvas.height) continue;
          out.data[di] = pixels[si];
          out.data[di + 1] = pixels[si + 1];
          out.data[di + 2] = pixels[si + 2];
          out.data[di + 3] = pixels[si + 3];
        }
      }
      return out;
    },
    putImageData(img: StubImageData, x: number, y: number) {
      resizeBuffer();
      const cw = canvas.width;
      for (let row = 0; row < img.height; row++) {
        for (let col = 0; col < img.width; col++) {
          const dx = x + col;
          const dy = y + row;
          if (dx < 0 || dy < 0 || dx >= cw || dy >= canvas.height) continue;
          const si = (row * img.width + col) * 4;
          const di = (dy * cw + dx) * 4;
          pixels[di] = img.data[si];
          pixels[di + 1] = img.data[si + 1];
          pixels[di + 2] = img.data[si + 2];
          pixels[di + 3] = img.data[si + 3];
        }
      }
      push("putImageData", [x, y, img.width, img.height]);
    },

    drawImage(source: unknown, ...rest: number[]) {
      const src = source as HTMLCanvasElement;
      record.push({
        kind: "drawImage",
        args: rest,
        transform: [...transform],
        globalAlpha: ctx.globalAlpha,
        globalCompositeOperation: ctx.globalCompositeOperation,
        filter: ctx.filter,
        fillStyle: String(ctx.fillStyle),
        source: src,
      });
      // Copy the source's pixels when the placement is a plain translation, so a
      // bounce-through-a-scratch-canvas (as `blur` and `bakeTransform` do) keeps
      // whatever the test put in the buffer.
      const plain = transform[0] === 1 && transform[1] === 0 && transform[2] === 0 && transform[3] === 1;
      const srcCtx = plain ? getStubContext(src) : null;
      if (srcCtx) {
        const dx = Math.round((rest[0] ?? 0) + transform[4]);
        const dy = Math.round((rest[1] ?? 0) + transform[5]);
        blit(srcCtx.__pixels, src.width, src.height, pixels, canvas.width, canvas.height, dx, dy);
      }
    },
  };

  function push(kind: DrawCall["kind"], args: number[]) {
    record.push({
      kind,
      args,
      transform: [...transform],
      globalAlpha: ctx.globalAlpha,
      globalCompositeOperation: ctx.globalCompositeOperation,
      filter: ctx.filter,
      fillStyle: String(ctx.fillStyle),
    });
  }

  function resizeBuffer() {
    const need = Math.max(1, canvas.width) * Math.max(1, canvas.height) * 4;
    if (pixels.length !== need) pixels = new Uint8ClampedArray(need);
  }

  return ctx;
}

function blit(
  src: Uint8ClampedArray, sw: number, sh: number,
  dst: Uint8ClampedArray, dw: number, dh: number, dx: number, dy: number,
) {
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const tx = dx + x;
      const ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= dw || ty >= dh) continue;
      const si = (y * sw + x) * 4;
      const di = (ty * dw + tx) * 4;
      if (src[si + 3] === 0) continue; // treat fully transparent as "nothing drawn"
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
}

const contexts = new WeakMap<HTMLCanvasElement, ReturnType<typeof makeContext>>();

/** The stub context for a canvas, if one has been created. */
export function getStubContext(
  canvas: HTMLCanvasElement | undefined | null,
): (StubContextExtras & { __record: DrawCall[] }) | null {
  if (!canvas) return null;
  const ctx = contexts.get(canvas);
  return (ctx as unknown as StubContextExtras & { __record: DrawCall[] }) ?? null;
}

/** Every recorded call on a canvas, oldest first. */
export function drawCalls(canvas: HTMLCanvasElement): DrawCall[] {
  return getStubContext(canvas)?.__record ?? [];
}

/** Only the drawImage calls — the compositor's actual output. */
export function imageDraws(canvas: HTMLCanvasElement): DrawCall[] {
  return drawCalls(canvas).filter((c) => c.kind === "drawImage");
}

/** Write a flat RGBA colour into a canvas's pixel buffer, for LUT tests. */
export function seedPixels(
  canvas: HTMLCanvasElement, rgba: [number, number, number, number],
): void {
  const ctx = getStubContext(canvas);
  if (!ctx) throw new Error("seedPixels: canvas has no stub context yet — call getContext first");
  const px = ctx.__pixels;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = rgba[0]; px[i + 1] = rgba[1]; px[i + 2] = rgba[2]; px[i + 3] = rgba[3];
  }
}

/** Read one pixel out of a canvas's buffer. */
export function readPixel(
  canvas: HTMLCanvasElement, x = 0, y = 0,
): [number, number, number, number] {
  const ctx = getStubContext(canvas);
  if (!ctx) throw new Error("readPixel: canvas has no stub context yet");
  const i = (y * canvas.width + x) * 4;
  const px = ctx.__pixels;
  return [px[i], px[i + 1], px[i + 2], px[i + 3]];
}

/**
 * Install the stub globally. Idempotent, so importing it from more than one
 * setup file is harmless.
 */
export function installCanvasStub(): void {
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  if (proto.__meroStubInstalled) return;
  proto.__meroStubInstalled = true;

  proto.getContext = function getContext(this: HTMLCanvasElement, kind: string) {
    if (kind !== "2d") return null;
    const existing = contexts.get(this);
    if (existing) return existing;
    const ctx = makeContext(this);
    contexts.set(this, ctx);
    return ctx;
  };

  proto.toDataURL = function toDataURL() {
    // Enough to be a valid-looking PNG data URL for code that only forwards it.
    return "data:image/png;base64,iVBORw0KGgo=";
  };

  proto.toBlob = function toBlob(this: HTMLCanvasElement, cb: (b: Blob | null) => void) {
    cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));
  };

  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.Path2D) g.Path2D = StubPath2D;
  if (!g.ImageData) g.ImageData = StubImageData;
}

export { StubPath2D, StubImageData };
