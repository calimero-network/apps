import { describe, expect, it, vi } from "vitest";
import type { CloudMero } from "@calimero-apps/cloud";
import { envBlock, issueFormKey, listFormKeys } from "./formKey";

describe("form keys", () => {
  it("are API keys scoped to one app and to submit_response", async () => {
    const post = vi.fn(async () => ({ keyId: "k1", key: "secret" }));
    const key = await issueFormKey({ post } as unknown as CloudMero, "ctx", "form-1", "site");
    expect(post).toHaveBeenCalledWith("auth/apikeys", { label: "mero-forms:form-1:site", apps: ["ctx"], methods: ["submit_response"] });
    expect(key).toMatchObject({ keyId: "k1", secret: "secret", formId: "form-1", label: "site" });
  });

  it("keeps a label with colons intact, and ignores keys that are not form keys", async () => {
    const get = vi.fn(async () => ({ keys: [{ keyId: "a", label: "mero-forms:f:a:b", expiresAt: 0 }, { keyId: "z", label: "cli", expiresAt: 0 }] }));
    expect(await listFormKeys({ get } as unknown as CloudMero)).toEqual([{ keyId: "a", formId: "f", label: "a:b", expiresAt: 0 }]);
  });

  it("hands the website what it needs and nothing else", () => {
    const env = envBlock("https://c", "ctx", { keyId: "k", secret: "s", formId: "f", label: "l", expiresAt: 0 });
    expect(env.split("\n")).toEqual(["CALIMERO_URL=https://c", "CALIMERO_APP_ID=ctx", "CALIMERO_FORM_ID=f", "CALIMERO_API_KEY=s"]);
  });
});
