import { describe, expect, it } from "vitest";
import { installedApps } from "./useNodeFeed";

describe("the apps installed on your node", () => {
  it("names each once by its key, leaving Hyperfeed out", () => {
    expect(
      installedApps(
        {
          feed1: "com.calimero.hyperfeed",
          feed0: "com.calimero.hyperfeed",
          chat1: "com.calimero.mero-chat",
          chat2: "com.calimero.mero-chat",
          docs: "com.calimero.docs",
          anon1234abcd: undefined,
        },
        "feed1",
      ),
    ).toEqual(["chat", "docs", "app-anon1234"]);
  });
});
