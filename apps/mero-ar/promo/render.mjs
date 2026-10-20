// Renders the promo (16:9 and 9:16) to ../landing/public/media/.
// The app recordings it plays come from scripts/record-demo.sh; this copies
// them into public/ first so a fresh checkout renders after one recording run.
import { bundle } from "@remotion/bundler";
import { getCompositions, renderMedia, renderStill } from "@remotion/renderer";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const media = path.resolve("../landing/public/media");
for (const clip of ["clip-room.mp4", "clip-invite.mp4", "clip-signin.mp4", "clip-scan.mp4"]) {
  const from = path.join(media, clip);
  if (!existsSync(from)) throw new Error(`missing ${from}: run scripts/record-demo.sh first`);
  copyFileSync(from, path.resolve("public", clip));
}

const only = process.argv.slice(2);
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
for (const composition of await getCompositions(serveUrl)) {
  if (only.length && !only.includes(composition.id)) continue;
  const raw = path.resolve("out", `${composition.id}.mp4`);
  await renderMedia({ composition, serveUrl, codec: "h264", crf: 20, outputLocation: raw, concurrency: 6, muted: true });
  console.log("rendered", raw);
  if (composition.id === "promo") {
    await renderStill({ composition, serveUrl, output: path.join(media, "promo-poster.jpg"), frame: 75, imageFormat: "jpeg" });
  }
}
console.log("now compress: see README (ffmpeg -crf 28)");
