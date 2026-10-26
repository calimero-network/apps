// A relative base resolves built assets below a deep route (`/spaces/1` asks for `/spaces/assets/x.js`).
// The node serves that tail from `/assets/`; this lets `vite preview` do the same.
export const assetTail = (url: string): string => url.replace(/^\/.+?\/(assets\/)/, "/$1");

export const servedAssetsFallback = () => ({
  name: "served-assets-fallback",
  configurePreviewServer(server: {
    middlewares: { use(fn: (req: { url?: string }, res: unknown, next: () => void) => void): void };
  }) {
    server.middlewares.use((req, _res, next) => {
      if (req.url) req.url = assetTail(req.url);
      next();
    });
  },
});
