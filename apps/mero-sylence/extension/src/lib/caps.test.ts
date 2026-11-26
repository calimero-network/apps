import { describe, expect, it } from "vitest";
import { cachedTiers } from "./caps";

describe("cachedTiers", () => {
  const store = (urls: string[]) =>
    ({ open: async () => ({ keys: async () => urls.map((url) => ({ url })) }) }) as unknown as CacheStorage;
  const hf = (repo: string, file: string) => `https://huggingface.co/${repo}/resolve/main/onnx/${file}`;

  it("names a tier once both its encoder and decoder are cached", async () => {
    const urls = [
      hf("onnx-community/whisper-large-v3-turbo", "encoder_model_fp16.onnx"),
      hf("onnx-community/whisper-large-v3-turbo", "decoder_model_merged_q4f16.onnx"),
      hf("onnx-community/moonshine-base-ONNX", "encoder_model_quantized.onnx"),
    ];
    expect(await cachedTiers(store(urls))).toEqual(["best"]);
  });

  it("is empty without Cache Storage", async () => {
    expect(await cachedTiers(undefined)).toEqual([]);
  });
});
