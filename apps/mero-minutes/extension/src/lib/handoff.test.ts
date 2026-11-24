import { sealNativeSession } from "@calimero-apps/passkey/native";
import { describe, expect, it } from "vitest";
import { b64url, fromB64url } from "./b64url";
import { HandoffError, newHandoff, openHandoff, signInUrl, type HandoffSession } from "./handoff";

const SESSION: HandoffSession = {
  v: 1,
  accountId: "acc-1",
  sessionToken: "tok",
  expiresAt: 1_800_000_000_000,
  refreshToken: "ref",
  nodeUrl: "https://node-1.eu-shared-1.calimero.network",
  nodes: ["https://node-2.eu-shared-1.calimero.network"],
};
const CALLBACK = "https://ljpjgindjakdpmbpjdcpadihhnaemocf.chromiumapp.org/signed-in";

/** What the served page sends back, sealed with the page's own code (packages/passkey). */
async function pageAnswer(state: string, key: string, session: unknown = SESSION): Promise<string> {
  const box = await sealNativeSession({ state, key }, session as HandoffSession);
  return `${CALLBACK}#state=${encodeURIComponent(state)}&box=${encodeURIComponent(box)}`;
}

describe("served-page handoff", () => {
  it("opens the session the page sealed", async () => {
    const req = await newHandoff();
    expect(fromB64url(req.key)).toHaveLength(65);
    expect(fromB64url(req.key)[0]).toBe(4);
    expect(req.state.length).toBeGreaterThanOrEqual(16);
    expect(await openHandoff(req, await pageAnswer(req.state, req.key))).toEqual(SESSION);
  });

  it("refuses an answer for another request", async () => {
    const req = await newHandoff();
    const other = await newHandoff();
    await expect(openHandoff(req, await pageAnswer(other.state, req.key))).rejects.toThrow(/another request/);
  });

  it("refuses a box sealed to another key", async () => {
    const req = await newHandoff();
    const other = await newHandoff();
    await expect(openHandoff(req, await pageAnswer(req.state, other.key))).rejects.toThrow(HandoffError);
  });

  it("refuses a tampered box", async () => {
    const req = await newHandoff();
    const answer = new URL(await pageAnswer(req.state, req.key));
    const params = new URLSearchParams(answer.hash.slice(1));
    const box = fromB64url(params.get("box")!);
    box[box.length - 1] = (box[box.length - 1] as number) ^ 1;
    const tampered = `${CALLBACK}#state=${req.state}&box=${b64url(box)}`;
    await expect(openHandoff(req, tampered)).rejects.toThrow(/could not be opened/);
  });

  it("refuses a box bound to another state (AAD)", async () => {
    const req = await newHandoff();
    const sealedFor = await pageAnswer("x".repeat(20), req.key);
    const box = new URLSearchParams(new URL(sealedFor).hash.slice(1)).get("box")!;
    await expect(openHandoff(req, `${CALLBACK}#state=${req.state}&box=${box}`)).rejects.toThrow(/could not be opened/);
  });

  it("refuses a malformed session and a missing answer", async () => {
    const req = await newHandoff();
    await expect(openHandoff(req, await pageAnswer(req.state, req.key, { v: 2 }))).rejects.toThrow(/malformed/);
    await expect(openHandoff(req, await pageAnswer(req.state, req.key, { ...SESSION, nodeUrl: "ftp://x" }))).rejects.toThrow(
      /malformed/,
    );
    await expect(openHandoff(req, `${CALLBACK}#`)).rejects.toThrow(/no answer/);
    await expect(openHandoff(req, `${CALLBACK}#state=${req.state}&cancelled=1`)).rejects.toThrow(/cancelled/);
    await expect(openHandoff(req, `${CALLBACK}#state=${req.state}&box=!!`)).rejects.toThrow(/malformed/);
  });

  it("builds the page address the served page captures", () => {
    const req = { state: "s".repeat(43), key: "k".repeat(87) };
    expect(signInUrl("https://abc.apps.calimero.network/", "0.0.3", req)).toBe(
      `https://abc.apps.calimero.network/0.0.3/#native-sign-in&state=${req.state}&key=${req.key}`,
    );
    expect(signInUrl("http://localhost:5173", null, req)).toBe(
      `http://localhost:5173/#native-sign-in&state=${req.state}&key=${req.key}`,
    );
    expect(signInUrl("http://localhost:5173", null, req, "create")).toBe(
      `http://localhost:5173/#native-sign-in&state=${req.state}&key=${req.key}&intent=create`,
    );
    // A version can't end the path.
    expect(signInUrl("https://a.b", "1/../x", req)).toContain("/1%2F..%2Fx/#");
  });
});
