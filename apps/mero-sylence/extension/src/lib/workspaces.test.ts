import { describe, expect, it } from "vitest";
import { pickWorkspaces } from "./workspaces";

const PKG = "com.calimero.mero-sylence";
const apps = [
  { appId: "b", name: "Sales", package: PKG },
  { appId: "a", name: "", package: PKG },
  { appId: "dev", name: "Local team", package: null },
  { appId: "other", name: "Chat", package: "com.calimero.mero-chat" },
];

describe("pickWorkspaces", () => {
  it("offers only the package's instances on Cloud, by name", () => {
    expect(pickWorkspaces(apps, PKG, false)).toEqual([
      { appId: "b", name: "Sales" },
      { appId: "a", name: "Untitled workspace" },
    ]);
  });

  it("adds bundle instances when signed in on a development page", () => {
    expect(pickWorkspaces(apps, PKG, true).map((w) => w.appId)).toEqual(["dev", "b", "a"]);
  });
});
