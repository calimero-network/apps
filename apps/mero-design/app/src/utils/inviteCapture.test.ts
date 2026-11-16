import { describe, expect, it } from "vitest";
import mainSrc from "../main.tsx?raw";

describe("invitation capture at boot", () => {
  // The router replaces the URL on its first navigation, and a person opening
  // a link is usually not signed in yet: the token is taken into storage
  // before React mounts, or it is lost.
  it("captures ?invite= before the app renders", () => {
    expect(mainSrc.indexOf("captureInvite()")).toBeGreaterThan(-1);
    expect(mainSrc.indexOf("captureInvite()")).toBeLessThan(mainSrc.indexOf("createRoot("));
  });
});
