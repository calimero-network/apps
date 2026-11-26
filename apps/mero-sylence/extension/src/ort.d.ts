/** onnxruntime-web's files, by URL (vite.config.ts aliases `@ort` to its dist/). */
declare module "@ort/*?url" {
  const url: string;
  export default url;
}
