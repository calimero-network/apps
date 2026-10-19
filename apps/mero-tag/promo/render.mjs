// Renders the promo (16:9 and 9:16) from the real screen recordings in
// ../landing/public/media, then compresses them for the web into the same folder.
import { bundle } from "@remotion/bundler";
import { getCompositions, renderMedia } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import path from "node:path";

const publicDir = path.resolve("../landing/public");
const media = path.join(publicDir, "media");
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts"), publicDir });
for (const composition of await getCompositions(serveUrl)) {
  const raw = path.resolve("out", `${composition.id}.mp4`);
  await renderMedia({ composition, serveUrl, codec: "h264", crf: 18, outputLocation: raw, concurrency: 4 });
  const web = path.join(media, `${composition.id}.mp4`);
  const width = composition.width > composition.height ? 1280 : 720;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-an", "-vf", `scale=${width}:-2`, "-c:v", "libx264",
    "-preset", "slow", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", web]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "2", "-i", web, "-frames:v", "1", "-q:v", "4",
    path.join(media, `${composition.id}.jpg`)]);
  console.log("rendered", web);
}
