/**
 * Paints a recognisable moving test pattern into a canvas.
 *
 * The screenshots have to show SOMETHING in the tiles: a black rectangle would
 * document the layout while saying nothing about whether video lands in it. A
 * pattern also makes tile identity obvious at a glance, which a real camera
 * feed of four people in the same room would not.
 *
 * Deliberately not a photo: nothing here should be mistakable for a real
 * person's camera, and a synthetic pattern cannot be.
 */
const HUES = [205, 145, 32, 280, 0];

export function paintPattern(
  canvas: HTMLCanvasElement,
  label: string,
  seed: number,
): () => void {
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  let frame = 0;
  let raf = 0;
  const hue = HUES[seed % HUES.length];

  const draw = () => {
    const w = canvas.width;
    const h = canvas.height;
    const t = frame / 60;

    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${hue} 45% 22%)`);
    g.addColorStop(1, `hsl(${(hue + 40) % 360} 40% 12%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // A drifting ring, so consecutive screenshots visibly differ — the same
    // property the e2e's "the picture advances" check relies on.
    ctx.strokeStyle = `hsl(${hue} 70% 62%)`;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(
      w / 2 + Math.cos(t) * w * 0.18,
      h / 2 + Math.sin(t * 0.8) * h * 0.16,
      74,
      0,
      Math.PI * 2,
    );
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font =
      "600 44px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, w / 2, h / 2);

    ctx.font = "500 18px ui-monospace, Menlo, monospace";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText("640x480 · H.264 · test pattern", w / 2, h - 40);

    frame += 1;
    raf = requestAnimationFrame(draw);
  };
  draw();
  return () => cancelAnimationFrame(raf);
}

/**
 * A MediaStream carrying the pattern, for the local-preview <video>.
 *
 * `captureStream` rather than painting into the tile directly, because the self
 * tile is a real <video> element reading from the camera and the harness should
 * exercise that element rather than substitute a canvas for it.
 */
export function patternStream(label: string, seed: number): MediaStream {
  const canvas = document.createElement("canvas");
  paintPattern(canvas, label, seed);
  return canvas.captureStream(30);
}
