import { describe, expect, it } from "vitest";
import { installedApps } from "./useNodeFeed";

const app = (appId: string, pkg: string | null, bundle = `bundle-${appId}`) => ({ appId, package: pkg, bundle });

describe("the apps you reach", () => {
  it("names each once by its key, leaving Hyperfeed out", () => {
    expect(
      installedApps(
        [
          app("feed1", "com.calimero.hyperfeed"),
          app("feed0", "com.calimero.hyperfeed"),
          app("chat1", "com.calimero.mero-chat"),
          app("chat2", "com.calimero.mero-chat"),
          app("docs", "com.calimero.docs"),
          app("anon", null, "anon1234abcd"),
        ],
        "feed1",
      ),
    ).toEqual(["chat", "docs", "app-anon1234"]);
  });

  it("leaves out a dev build of Hyperfeed by its bundle", () => {
    expect(installedApps([app("feed1", null, "hf-dev"), app("feed2", null, "hf-dev")], "feed1", "hf-dev")).toEqual([]);
  });
});
