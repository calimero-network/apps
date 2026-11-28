import { describe, expect, it, vi } from "vitest";
import { compareVersions, moveToServedRelease, newerPage, servedVersion, versionInPath } from "./served";

const PROD = {
  package: "com.calimero.sylence",
  versions: ["0.0.1", "0.0.3"],
  deployments: [{ id: "330d7cda21cdd342139bc02bd6f0336b", name: "sylence (production)", app: "sylence", version: "0.0.3" }],
};
const HOST = "https://xlf.apps.calimero.network";

describe("the release a page is served at", () => {
  it("reads the release from the path", () => {
    expect(versionInPath("/0.0.1/")).toBe("0.0.1");
    expect(versionInPath("/0.0.3")).toBe("0.0.3");
    expect(versionInPath("/")).toBeNull();
    expect(versionInPath("/d/330d/")).toBeNull();
  });

  it("compares as numbers", () => {
    expect(compareVersions("0.0.10", "0.0.9")).toBeGreaterThan(0);
    expect(compareVersions("0.0.3", "0.0.3")).toBe(0);
  });

  it("serves the deployment's release, the one in the address first", () => {
    expect(servedVersion(PROD)).toBe("0.0.3");
    expect(servedVersion(PROD, "330d7cda21cdd342139bc02bd6f0336b")).toBe("0.0.3");
    expect(servedVersion({ versions: ["0.0.9", "0.0.10"] })).toBe("0.0.10");
    expect(servedVersion({ versions: ["../x"] })).toBeNull();
  });
});

describe("moving an old page to the served release", () => {
  it("prod: /0.0.1/?deployment=… goes to /0.0.3/, keeping the query and the fragment", () => {
    expect(newerPage(`${HOST}/0.0.1/?deployment=330d7cda21cdd342139bc02bd6f0336b#/w/app1`, PROD)).toBe(
      `${HOST}/0.0.3/?deployment=330d7cda21cdd342139bc02bd6f0336b#/w/app1`,
    );
  });

  it("keeps the extension's sign-in handoff in the fragment", () => {
    expect(newerPage(`${HOST}/0.0.1/#native-sign-in&state=s&key=k&intent=create`, PROD)).toBe(
      `${HOST}/0.0.3/#native-sign-in&state=s&key=k&intent=create`,
    );
  });

  it("stays on the served release, a newer one, and a page served at its root", () => {
    expect(newerPage(`${HOST}/0.0.3/`, PROD)).toBeNull();
    expect(newerPage(`${HOST}/0.0.4/`, PROD)).toBeNull();
    expect(newerPage("http://localhost:5173/#/w/a", PROD)).toBeNull();
  });

  it("moves with location.replace, and stays put when the host does not answer", async () => {
    const replace = vi.fn();
    const at = { href: `${HOST}/0.0.1/`, origin: HOST, replace };
    expect(await moveToServedRelease(at, async () => new Response(JSON.stringify(PROD)))).toBe(true);
    expect(replace).toHaveBeenCalledWith(`${HOST}/0.0.3/`);
    replace.mockClear();
    expect(await moveToServedRelease(at, async () => Promise.reject(new Error("offline")))).toBe(false);
    expect(await moveToServedRelease(at, async () => new Response("", { status: 404 }))).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});
