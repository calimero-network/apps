/**
 * The UV checker: an 8×8 grid of numbered, coloured cells. Squares that stay
 * square on the model mean an even, unstretched layout; the numbers and
 * colours show which way each island is turned and where seams fall.
 */
let canvas: HTMLCanvasElement | null = null;

export function checkerCanvas(): HTMLCanvasElement {
  if (canvas) return canvas;
  const size = 1024;
  const cells = 8;
  const step = size / cells;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const hues = [0, 30, 55, 120, 180, 210, 260, 310];
  for (let row = 0; row < cells; row += 1) {
    for (let col = 0; col < cells; col += 1) {
      const light = (row + col) % 2 === 0;
      ctx.fillStyle = `hsl(${hues[col]!} ${light ? 55 : 45}% ${light ? 72 : 38}%)`;
      ctx.fillRect(col * step, row * step, step, step);
      // A smaller square in each cell makes stretch obvious at a glance.
      ctx.fillStyle = light ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.18)";
      ctx.fillRect(col * step + step / 4, row * step + step / 4, step / 2, step / 2);
      ctx.fillStyle = light ? "#1b1c1f" : "#f2f2f2";
      ctx.font = `600 ${Math.round(step / 4)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Row letters count up the texture, as V does.
      ctx.fillText(`${String.fromCharCode(65 + (cells - 1 - row))}${col + 1}`, col * step + step / 2, row * step + step / 2);
    }
  }
  canvas = c;
  return c;
}
