import { describe, expect, it, vi } from "vitest";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import type { Target } from "@calimero-apps/connect";
import { signUpHere } from "./ceremony";
import { labelledName, labelledPasskey, passkeyAppName, passkeyCluster, passkeyName } from "./passkeyName";

const CLOUD: Target = { kind: "cloud", cluster: "eu-shared-1", minReleaseVersion: "0.0.0" };
const LOCAL: Target = { kind: "local", nodes: ["http://127.0.0.1:2501"] };
const POLICY = { cluster: "eu-shared-1", passkeyTag: "3f2a" };
const CLUSTER = "eu-shared-1 · 3f2a";

function recording() {
  const create = vi.fn(async (_options: Record<string, unknown>, _o?: unknown) => ({
    attestationObject: "a",
    clientDataJson: "c",
  }));
  const passkey = { create, get: vi.fn() } as unknown as PasskeyProvider;
  return { passkey, create };
}

const userOf = (create: ReturnType<typeof recording>["create"], i = 0) =>
  create.mock.calls[i]?.[0].user as { id: string; name: string; displayName: string };

describe("passkey names", () => {
  it("leads with the label, then the app and the cluster", () => {
    expect(passkeyCluster(CLOUD, POLICY)).toBe(CLUSTER);
    expect(passkeyCluster(CLOUD)).toBe("eu-shared-1");
    expect(passkeyCluster(LOCAL)).toBe("local");
    expect(passkeyName("Work laptop", CLUSTER, "Sylence")).toBe("Work laptop · Sylence (eu-shared-1 · 3f2a)");
    expect(passkeyName("", "local · fa1d", "Sylence")).toBe("Sylence (local · fa1d)");
    expect(passkeyName(" ", "local", null)).toBe("local");
    expect(passkeyName("A".repeat(40), "local", null)).toBe(`${"A".repeat(31)}… · local`);
  });

  it("never says Calimero user, and keeps the node's app and cluster", () => {
    const naming = { person: "", label: "", cluster: CLUSTER, app: "Sylence" };
    // The node's name on a package's frontend.
    expect(labelledName("Calimero user · Sylence (eu-shared-1 · 3f2a)", naming)).toBe("Sylence (eu-shared-1 · 3f2a)");
    expect(labelledName("Calimero user · Sylence (eu-shared-1 · 3f2a)", { ...naming, label: "Work laptop", app: "Other" })).toBe(
      "Work laptop · Sylence (eu-shared-1 · 3f2a)",
    );
    // A page that is not a package's frontend: the app goes in.
    expect(labelledName("Calimero user · eu-shared-1 · 3f2a", naming)).toBe("Sylence (eu-shared-1 · 3f2a)");
    // A node before passkey names.
    expect(labelledName("Calimero user", { ...naming, label: "Phone" })).toBe("Phone · Sylence (eu-shared-1 · 3f2a)");
    // An app that sends the account's name: it leads where there is no label.
    expect(labelledName("Alex · Sylence (eu-shared-1 · 3f2a)", { ...naming, person: "Alex" })).toBe(
      "Alex · Sylence (eu-shared-1 · 3f2a)",
    );
    expect(labelledName("Alex · Sylence (eu-shared-1 · 3f2a)", { ...naming, person: "Alex", label: "Phone" })).toBe(
      "Phone · Sylence (eu-shared-1 · 3f2a)",
    );
  });

  it("renames only the shown name, never the user id, and passes the prompt's signal on", async () => {
    const { passkey, create } = recording();
    const named = labelledPasskey(passkey, { person: "", label: "Work laptop", cluster: CLUSTER, app: "Sylence" });
    const signal = new AbortController().signal;
    await named.create({ user: { id: "dXNlcg", name: "Calimero user", displayName: "Calimero user" } }, { signal });
    expect(userOf(create)).toEqual({
      id: "dXNlcg",
      name: "Work laptop · Sylence (eu-shared-1 · 3f2a)",
      displayName: "Work laptop · Sylence (eu-shared-1 · 3f2a)",
    });
    expect(create.mock.calls[0]?.[1]).toEqual({ signal });
  });

  it("takes the app's name from the page title by default", () => {
    const doc = globalThis.document;
    const title = doc.title;
    doc.title = "Sylence — Private meeting notes";
    try {
      expect(passkeyAppName()).toBe("Sylence");
      expect(passkeyAppName("Notes")).toBe("Notes");
      expect(passkeyAppName(null)).toBeNull();
    } finally {
      doc.title = title;
    }
  });

  it("a sign-up labels its passkey and never sends the label as the account's name", async () => {
    const { passkey, create } = recording();
    const client = {
      signUp: vi.fn(async (p: PasskeyProvider, name: string) => {
        const shown = `${name || "Calimero user"} · Sylence (eu-shared-1 · 3f2a)`;
        await p.create({ user: { id: "dXNlcg", name: shown, displayName: shown } });
        return { accountId: "acct-1" };
      }),
    } as unknown as CalimeroClient;
    await signUpHere(client, CLOUD, passkey, {
      passkeyLabel: " Work laptop ",
      policy: { policy: "open", orgInvites: true, signUpInvites: true, inviteRequired: false, ...POLICY },
      appName: "Sylence",
    });
    expect(userOf(create).name).toBe("Work laptop · Sylence (eu-shared-1 · 3f2a)");
    expect(vi.mocked(client.signUp).mock.calls[0]?.[1]).toBe("");
  });
});
