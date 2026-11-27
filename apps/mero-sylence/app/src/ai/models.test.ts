import { describe, expect, it, vi } from "vitest";
import { MODEL_REVISIONS, pinnedFetch, pinnedUrl } from "./models";

const SHA = MODEL_REVISIONS["onnx-community/whisper-base"]!;

describe("pinnedUrl", () => {
  it("moves any ref of a listed repo to its pinned commit", () => {
    expect(pinnedUrl("https://huggingface.co/onnx-community/whisper-base/resolve/main/config.json")).toBe(
      `https://huggingface.co/onnx-community/whisper-base/resolve/${SHA}/config.json`,
    );
    expect(pinnedUrl(`https://huggingface.co/onnx-community/whisper-base/resolve/${SHA}/onnx/encoder_model.onnx`)).toBe(
      `https://huggingface.co/onnx-community/whisper-base/resolve/${SHA}/onnx/encoder_model.onnx`,
    );
  });
  it("refuses a repo that is not pinned, and Hugging Face URLs that are not file reads", () => {
    expect(() => pinnedUrl("https://huggingface.co/evil/model/resolve/main/config.json")).toThrow(/not a pinned model/);
    expect(() => pinnedUrl("https://huggingface.co/api/models/onnx-community/whisper-base")).toThrow(/unpinned/);
  });
  it("leaves other URLs alone", () => {
    expect(pinnedUrl("https://example.com/ort.wasm")).toBe("https://example.com/ort.wasm");
    expect(pinnedUrl("/assets/ort.wasm")).toBe("/assets/ort.wasm");
  });
});

describe("pinnedFetch", () => {
  it("fetches the pinned URL", async () => {
    const base = vi.fn(async () => new Response("ok"));
    await pinnedFetch(base as unknown as typeof fetch)("https://huggingface.co/onnx-community/whisper-base/resolve/main/config.json");
    expect(base).toHaveBeenCalledWith(`https://huggingface.co/onnx-community/whisper-base/resolve/${SHA}/config.json`, undefined);
  });
});
