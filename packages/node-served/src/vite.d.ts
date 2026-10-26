export declare const assetTail: (url: string) => string;
export declare const servedAssetsFallback: () => {
  name: string;
  configurePreviewServer(server: {
    middlewares: { use(fn: (req: { url?: string }, res: unknown, next: () => void) => void): void };
  }): void;
};
