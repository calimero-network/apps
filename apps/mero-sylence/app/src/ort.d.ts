/** onnxruntime-web's files, by URL (vite.config.ts aliases `/ort-dist/` to its dist/). */
declare module "/ort-dist/*?url" {
  const url: string;
  export default url;
}
