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
