import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NativeApproval } from "./NativeApproval";
import { b64url, type NativeApprovalRequest } from "./native";

async function request(): Promise<NativeApprovalRequest> {
  const ecdh = { name: "ECDH", namedCurve: "P-256" } as const;
  const pair = (await crypto.subtle.generateKey(ecdh, true, ["deriveBits"])) as CryptoKeyPair;
  return {
    state: "c3RhdGUtZm9yLXRoaXMtYXBwcm92YWw",
    key: b64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
    challenge: b64url(new Uint8Array(32).fill(1)),
    rpId: "calimero.network",
    allow: [],
  };
}

const assertion = { credentialId: "c", authenticatorData: "a", clientDataJson: "d", signature: "s" };

describe("NativeApproval", () => {
  afterEach(cleanup);

  it("asks for the passkey on a tap and sends the app its answer", async () => {
    let went = "";
    render(
      <NativeApproval
        appName="Mero Chat"
        callback="mero-chat://approved"
        request={await request()}
        approver={{ get: async () => assertion }}
        go={(url) => (went = url)}
      />,
    );
    expect(screen.getByText("Approve in Mero Chat")).toBeTruthy();
    fireEvent.click(screen.getByTestId("native-approve"));
    await waitFor(() => expect(went.startsWith("mero-chat://approved#state=")).toBe(true));
    expect(went).toContain("&box=");
  });

  it("says when the prompt was closed, and lets the person cancel", async () => {
    let went = "";
    const closed = Object.assign(new Error("closed"), { name: "NotAllowedError" });
    render(
      <NativeApproval
        appName="Mero Chat"
        callback="mero-chat://approved"
        request={await request()}
        approver={{ get: async () => Promise.reject(closed) }}
        go={(url) => (went = url)}
      />,
    );
    fireEvent.click(screen.getByTestId("native-approve"));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByTestId("native-decline"));
    expect(went).toMatch(/#state=.*&cancelled=1$/);
  });
});
