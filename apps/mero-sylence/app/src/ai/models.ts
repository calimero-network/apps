/**
 * Every model the page loads, pinned to one Hugging Face commit.
 *
 * The weights, tokenizers and chat templates come from Hugging Face (once,
 * then from the browser's cache). A repo's `main` can change under us; a
 * commit cannot, so a changed or compromised repo does not change what this
 * page runs. To move a model, take the repo's new `sha` from
 * `https://huggingface.co/api/models/<repo>` and check it before bumping.
 */
export const MODEL_REVISIONS: Readonly<Record<string, string>> = {
  "onnx-community/whisper-large-v3-turbo": "360ebcde2559d60bb474678be3c1de9ef347d01a",
  "onnx-community/whisper-base": "27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c",
  "onnx-community/pyannote-segmentation-3.0": "733a93b6473d019a773298e08cefa686894b1854",
  "onnx-community/wespeaker-voxceleb-resnet34-LM": "6a61a1833ff2583aabeba044f5c8221f00b67ceb",
  "SamLowe/roberta-base-go_emotions-onnx": "90ee0c1c4796d370e68968687b8ba51fc11224f4",
  "onnx-community/Qwen2.5-0.5B-Instruct": "22942cb7d7ba4cc81bb4673549ca4d4614469b5e",
  "onnx-community/Qwen2.5-1.5B-Instruct": "d54957e3af1be04546436e874a60fe386041b244",
};

/** The pinned commit of `repo`; a repo not listed here is refused rather than loaded from `main`. */
export function revisionOf(repo: string): string {
  const sha = MODEL_REVISIONS[repo];
  if (!sha) throw new Error(`${repo} is not a pinned model`);
  return sha;
}

const HUB = "https://huggingface.co/";

/**
 * `url` with any Hugging Face file request moved to the pinned commit:
 * `https://huggingface.co/{repo}/resolve/{ref}/{file}` becomes
 * `…/resolve/{sha}/{file}`, whatever ref the library asked for (it asks for
 * `main` while it probes configs). A Hugging Face URL that names a repo not
 * listed in {@link MODEL_REVISIONS} throws. Anything else is left alone.
 */
export function pinnedUrl(url: string): string {
  if (!url.startsWith(HUB)) return url;
  const rest = url.slice(HUB.length);
  const at = rest.indexOf("/resolve/");
  if (at < 0) throw new Error(`refused an unpinned Hugging Face request: ${url}`);
  const repo = rest.slice(0, at);
  const sha = revisionOf(repo);
  const after = rest.slice(at + "/resolve/".length);
  const slash = after.indexOf("/");
  if (slash < 0) throw new Error(`refused an unpinned Hugging Face request: ${url}`);
  return `${HUB}${repo}/resolve/${sha}/${after.slice(slash + 1)}`;
}

/** A `fetch` for transformers.js (`env.fetch`) that only ever reads pinned commits. */
export function pinnedFetch(base: typeof fetch = fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const pinned = pinnedUrl(url);
    return base(pinned === url ? input : pinned, init);
  }) as typeof fetch;
}
