import { parseDeviceCredential, verifyDeviceCredential } from "@calimero-network/mero-js";
import { describe, expect, it } from "vitest";
import { envBlock, mintFormIdentity } from "./formKey";

describe("form keys", () => {
  it("mints an account with one device certificate the network accepts", async () => {
    const key = await mintFormIdentity();
    expect(key.account).toMatch(/^[0-9a-f]{64}$/);
    expect(key.deviceSecret).toMatch(/^[0-9a-f]{64}$/);
    const checked = await verifyDeviceCredential(key.credential);
    expect(checked.account).toBe(key.account);
    expect(parseDeviceCredential(key.credential).deviceEpoch).toBe(1);
  });

  it("mints a new account every time", async () => {
    const [a, b] = await Promise.all([mintFormIdentity(), mintFormIdentity()]);
    expect(a.account).not.toBe(b.account);
    expect(a.deviceSecret).not.toBe(b.deviceSecret);
  });

  it("writes the variables the website's backend reads", () => {
    const env = envBlock({ account: "a1", credential: "c2", deviceSecret: "d3" }, "f4", "e5");
    expect(env.split("\n")).toEqual([
      "CALIMERO_CONTEXT_ID=f4",
      "CALIMERO_FORM_ID=e5",
      "CALIMERO_FORM_ACCOUNT=a1",
      "CALIMERO_FORM_CREDENTIAL=c2",
      "CALIMERO_FORM_DEVICE_SECRET=d3",
    ]);
  });
});
