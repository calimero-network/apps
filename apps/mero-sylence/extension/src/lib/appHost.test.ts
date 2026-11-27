import { appLabel as connectLabel } from "@calimero-apps/connect";
import { describe, expect, it } from "vitest";
import { PACKAGE, appLabel, appOrigin, isVersion, latestVersion, meetingLink, servedPage, workspaceLink } from "./appHost";

const json = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("app host", () => {
  it("names the package's origin exactly as packages/connect (and core) do", async () => {
    for (const pkg of [PACKAGE, "com.calimero.mero-forms", "x"]) {
      expect(await appLabel(pkg)).toBe(connectLabel(pkg));
    }
    expect(await appOrigin()).toBe(`https://${connectLabel(PACKAGE)}.apps.calimero.network`);
  });

  it("reads the newest served release", async () => {
    expect(await latestVersion("https://h.example/", json({ versions: ["0.0.1", "0.0.2"] }))).toBe("0.0.2");
    await expect(latestVersion("https://h.example", json({}, 404))).rejects.toThrow(/not served/);
    await expect(latestVersion("https://h.example", json({ versions: [] }))).rejects.toThrow(/no release/);
    await expect(latestVersion("https://h.example", json({ versions: ["../x"] }))).rejects.toThrow(/not a version/);
  });

  it("accepts only path-safe versions", () => {
    expect(isVersion("1.0.0-rc.35+b1")).toBe(true);
    expect(isVersion("")).toBe(false);
    expect(isVersion("-1")).toBe(false);
    expect(isVersion("a/b")).toBe(false);
  });

  it("uses an override as a root page", async () => {
    expect(await servedPage(" http://localhost:5173/ ")).toEqual({ origin: "http://localhost:5173", version: null });
    const page = await servedPage("", json({ versions: ["0.1.0"] }));
    expect(page).toEqual({ origin: await appOrigin(), version: "0.1.0" });
  });

  it("links to a meeting and a workspace on the page", () => {
    const page = { origin: "https://h.example", version: "0.1.0" };
    expect(meetingLink(page, "app 1", "m1")).toBe("https://h.example/0.1.0/#/w/app%201/m/m1");
    expect(workspaceLink({ origin: "http://localhost:5173", version: null })).toBe("http://localhost:5173/");
    expect(workspaceLink(page, "a")).toBe("https://h.example/0.1.0/#/w/a");
  });
});

describe("the sign-in page setting", () => {
  it("takes a page on this machine at its root", async () => {
    const { isLocalPage } = await import("./appHost");
    expect(isLocalPage("http://localhost:5173")).toBe(true);
    expect(isLocalPage("https://sylence.example.com")).toBe(false);
    expect(await servedPage("http://localhost:5173/", json({}))).toEqual({ origin: "http://localhost:5173", version: null });
  });

  it("takes Sylence's own Cloud page at its newest release", async () => {
    const own = await appOrigin();
    expect(await servedPage(`${own}/`, json({ versions: ["0.1.0", "0.2.0"] }))).toEqual({ origin: own, version: "0.2.0" });
    expect(await servedPage(`${own}/0.1.0/`, json({ versions: ["0.1.0"] }))).toEqual({ origin: own, version: "0.1.0" });
  });

  it("refuses another app's Cloud page, naming Sylence's", async () => {
    const own = await appOrigin();
    const home = `https://${await appLabel("com.calimero.mero-home")}.apps.calimero.network/`;
    await expect(servedPage(home, json({ versions: ["1.0.0"] }))).rejects.toThrow(own);
  });

  it("says plainly when the page does not answer", async () => {
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(servedPage(undefined, down)).rejects.toThrow(/did not answer: Sylence is not served there yet/);
  });
});
