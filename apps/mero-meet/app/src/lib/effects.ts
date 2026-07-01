// ── Camera background effects ──────────────────────────────────────────────────
//
// Real-time background blur using MediaPipe's Selfie Segmentation. We take the
// raw camera track, run per-frame person/background segmentation, composite a
// blurred background behind the sharp person onto a canvas, and expose the
// canvas as a MediaStream video track. The call engine publishes that track in
// place of the raw camera (via replaceTrack — no renegotiation), so remote peers
// see the blurred version.
//
// Everything is self-hosted: the WASM runtime is copied to /mediapipe/wasm by a
// Vite plugin and the model lives at /models/selfie_segmenter.tflite, so nothing
// is fetched from a CDN (the desktop webview's CSP would block that).

import {
  FilesetResolver,
  ImageSegmenter,
  type ImageSegmenterResult,
} from "@mediapipe/tasks-vision";

export type BgEffect = "none" | "blur";

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/models/selfie_segmenter.tflite";
const BLUR_PX = 14;

/**
 * Wraps a camera video track and produces a processed one with the chosen
 * background effect. Reusable across effect changes; call {@link close} to free
 * the GPU/segmenter when the call ends.
 */
export class BackgroundProcessor {
  private segmenter: ImageSegmenter | null = null;
  private readonly video: HTMLVideoElement;
  private readonly out: HTMLCanvasElement;
  private readonly outCtx: CanvasRenderingContext2D;
  private readonly person: HTMLCanvasElement;
  private readonly personCtx: CanvasRenderingContext2D;
  private readonly mask: HTMLCanvasElement;
  private readonly maskCtx: CanvasRenderingContext2D;
  private raf = 0;
  private running = false;
  private effect: BgEffect = "blur";
  private lastTs = -1;

  constructor() {
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.out = document.createElement("canvas");
    this.person = document.createElement("canvas");
    this.mask = document.createElement("canvas");
    this.outCtx = this.out.getContext("2d")!;
    this.personCtx = this.person.getContext("2d")!;
    this.maskCtx = this.mask.getContext("2d")!;
  }

  private async ensureSegmenter(): Promise<ImageSegmenter> {
    if (this.segmenter) return this.segmenter;
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    this.segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH },
      runningMode: "VIDEO",
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
    return this.segmenter;
  }

  /**
   * Begin processing `input` with `effect`, returning a MediaStream carrying the
   * processed video track. Throws if the segmenter fails to load (caller should
   * fall back to the raw track).
   */
  async start(input: MediaStream, effect: BgEffect): Promise<MediaStream> {
    this.effect = effect;
    await this.ensureSegmenter();

    this.video.srcObject = input;
    await this.video.play().catch(() => {/* autoplay policies are lenient for muted */});

    const track = input.getVideoTracks()[0];
    const settings = track?.getSettings() ?? {};
    const w = settings.width ?? this.video.videoWidth ?? 640;
    const h = settings.height ?? this.video.videoHeight ?? 480;
    for (const c of [this.out, this.person]) {
      c.width = w;
      c.height = h;
    }

    this.running = true;
    this.loop();

    const fps = typeof settings.frameRate === "number" ? settings.frameRate : 30;
    return this.out.captureStream(fps);
  }

  setEffect(effect: BgEffect): void {
    this.effect = effect;
  }

  private loop = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const seg = this.segmenter;
    const v = this.video;
    if (!seg || v.readyState < 2 || v.videoWidth === 0) return;

    // Resize output to the live frame if the camera changed resolution.
    if (this.out.width !== v.videoWidth || this.out.height !== v.videoHeight) {
      for (const c of [this.out, this.person]) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
      }
    }

    if (this.effect === "none") {
      this.outCtx.filter = "none";
      this.outCtx.drawImage(v, 0, 0, this.out.width, this.out.height);
      return;
    }

    // Monotonic timestamps required by VIDEO mode.
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    try {
      seg.segmentForVideo(v, ts, (result) => this.composite(result));
    } catch {
      // If a frame fails, fall back to the raw frame so video never freezes.
      this.outCtx.filter = "none";
      this.outCtx.drawImage(v, 0, 0, this.out.width, this.out.height);
    }
  };

  private composite(result: ImageSegmenterResult): void {
    const v = this.video;
    const w = this.out.width;
    const h = this.out.height;
    const conf = result.confidenceMasks?.[0];
    if (!conf) {
      this.outCtx.filter = "none";
      this.outCtx.drawImage(v, 0, 0, w, h);
      result.close?.();
      return;
    }

    // Build an alpha mask (person = opaque) at the model's mask resolution.
    const mw = conf.width;
    const mh = conf.height;
    const floats = conf.getAsFloat32Array();
    if (this.mask.width !== mw || this.mask.height !== mh) {
      this.mask.width = mw;
      this.mask.height = mh;
    }
    const img = this.maskCtx.createImageData(mw, mh);
    for (let i = 0; i < floats.length; i++) {
      // Selfie segmenter: higher confidence = person (foreground).
      const a = floats[i] > 0.5 ? 255 : 0;
      const j = i * 4;
      img.data[j] = 255;
      img.data[j + 1] = 255;
      img.data[j + 2] = 255;
      img.data[j + 3] = a;
    }
    this.maskCtx.putImageData(img, 0, 0);
    conf.close?.();

    // Foreground layer = sharp video kept only where the mask is opaque.
    this.personCtx.globalCompositeOperation = "source-over";
    this.personCtx.filter = "none";
    this.personCtx.clearRect(0, 0, w, h);
    this.personCtx.drawImage(v, 0, 0, w, h);
    this.personCtx.globalCompositeOperation = "destination-in";
    this.personCtx.imageSmoothingEnabled = true;
    this.personCtx.drawImage(this.mask, 0, 0, w, h);
    this.personCtx.globalCompositeOperation = "source-over";

    // Output = blurred background, then the sharp person on top.
    this.outCtx.globalCompositeOperation = "source-over";
    this.outCtx.filter = `blur(${BLUR_PX}px)`;
    this.outCtx.drawImage(v, 0, 0, w, h);
    this.outCtx.filter = "none";
    this.outCtx.drawImage(this.person, 0, 0, w, h);

    result.close?.();
  }

  /** Stop the render loop (keeps the segmenter loaded for a quick restart). */
  pause(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Tear everything down and free the segmenter. */
  close(): void {
    this.pause();
    this.video.srcObject = null;
    try {
      this.segmenter?.close();
    } catch {
      /* already closed */
    }
    this.segmenter = null;
  }
}
