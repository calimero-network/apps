import { describe, expect, it } from "vitest";
import { isServedByNode } from "./servedByNode";

const LABEL = "a".repeat(52);

describe("isServedByNode", () => {
  it("accepts a node's app host and the desktop's app origins", () => {
    for (const url of [
      `http://${LABEL}.localhost:2428/0.0.1/`,
      `https://${LABEL}.apps.example/0.0.1/`,
      `calimero-app://${LABEL}/0.0.1/`,
      `http://calimero-app.${LABEL}/0.0.1/`,
    ]) {
      expect(isServedByNode(new URL(url))).toBe(true);
    }
  });

  it("rejects every other origin", () => {
    for (const url of [
      "http://localhost:5173/",
      "https://mero-kv-store.vercel.app/",
      `http://${"a".repeat(51)}.localhost/`,
      `http://${"a".repeat(53)}.localhost/`,
      `http://${LABEL}/`,
      `calimero-app://${"a".repeat(51)}/`,
      `http://calimero-app.${LABEL}.evil.example/`,
    ]) {
      expect(isServedByNode(new URL(url))).toBe(false);
    }
  });
});
