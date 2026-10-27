// A relative base resolves built assets below a deep route (`/spaces/1` asks for `/spaces/assets/x.js`).
// The node serves that tail from `/assets/`; this lets `vite preview` do the same. Plain JS: vite.config loads it with Node.
export const assetTail = (url) => url.replace(/^\/.+?\/(assets\/)/, "/$1");

export const servedAssetsFallback = () => ({
  name: "served-assets-fallback",
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url) req.url = assetTail(req.url);
      next();
    });
  },
});
