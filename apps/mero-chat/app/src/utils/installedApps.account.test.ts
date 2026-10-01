import { afterEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { resolveInstalledAppId } from "./installedApps";
import { setAccountMode } from "../api/meroJsClient";

vi.mock("axios", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

afterEach(() => setAccountMode(false));

describe("resolveInstalledAppId on an account", () => {
  it("names the configured app without asking any node: founding names it and the relay resolves the bundle", async () => {
    setAccountMode(true);
    await expect(resolveInstalledAppId("app-1")).resolves.toBe("app-1");
    expect(axios.get).not.toHaveBeenCalled();
  });
});
