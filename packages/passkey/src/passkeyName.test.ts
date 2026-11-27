import { describe, expect, it, vi } from "vitest";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import type { KeyValueStorage, Target } from "@calimero-apps/connect";
import { signUpHere } from "./ceremony";
import {
  appNamedPasskey,
  passkeyAppName,
  passkeyCluster,
  passkeyName,
  rememberedSignUpName,
  withAppName,
} from "./passkeyName";

const CLOUD: Target = { kind: "cloud", cluster: "eu-shared-1", minReleaseVersion: "0.0.0" };
const LOCAL: Target = { kind: "local", nodes: ["http://127.0.0.1:2501"] };
const POLICY = { cluster: "eu-shared-1", passkeyTag: "3f2a" };

function memory(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

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
  it("names the person, the app and the cluster, as the node does", () => {
    expect(passkeyCluster(CLOUD, POLICY)).toBe("eu-shared-1 · 3f2a");
    expect(passkeyCluster(CLOUD)).toBe("eu-shared-1");
    expect(passkeyCluster(LOCAL)).toBe("local");
    expect(passkeyName("Alex", "eu-shared-1 · 3f2a", "Sylence")).toBe("Alex · Sylence (eu-shared-1 · 3f2a)");
    expect(passkeyName("", "eu-shared-1 · 3f2a", "Sylence")).toBe("Calimero user · Sylence (eu-shared-1 · 3f2a)");
    expect(passkeyName("Alex", "local", null)).toBe("Alex · local");
    expect(passkeyName("A".repeat(40), "local", null)).toBe(`${"A".repeat(31)}… · local`);
  });

  it("adds the app where the node left it out, and keeps a name the node made with it", () => {
    const cluster = "eu-shared-1 · 3f2a";
    // A node before passkey names: the person alone.
    expect(withAppName("Alex", "Alex", cluster, "Sylence")).toBe("Alex · Sylence (eu-shared-1 · 3f2a)");
    expect(withAppName("Calimero user", "", cluster, "Sylence")).toBe("Calimero user · Sylence (eu-shared-1 · 3f2a)");
    // A page that is not a package's frontend: no app in the node's name.
    expect(withAppName("Alex · eu-shared-1 · 3f2a", "Alex", cluster, "Sylence")).toBe(
      "Alex · Sylence (eu-shared-1 · 3f2a)",
    );
    // The node named the app from its package: kept.
    expect(withAppName("Alex · Sylence (eu-shared-1 · 3f2a)", "Alex", cluster, "Other")).toBe(
      "Alex · Sylence (eu-shared-1 · 3f2a)",
    );
    expect(withAppName("Alex · eu-shared-1 · 3f2a", "Alex", cluster, null)).toBe("Alex · eu-shared-1 · 3f2a");
  });

  it("renames only the shown name, never the user id, and passes the prompt's signal on", async () => {
    const { passkey, create } = recording();
    const named = appNamedPasskey(passkey, { person: "Alex", cluster: "eu-shared-1 · 3f2a", app: "Sylence" });
    const signal = new AbortController().signal;
    await named.create({ challenge: "x", user: { id: "dXNlcg", name: "Alex", displayName: "Alex" } }, { signal });
    expect(userOf(create)).toEqual({
      id: "dXNlcg",
      name: "Alex · Sylence (eu-shared-1 · 3f2a)",
      displayName: "Alex · Sylence (eu-shared-1 · 3f2a)",
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

  it("a sign-up names its passkey and remembers the name for the next one", async () => {
    const { passkey, create } = recording();
    const storage = memory();
    const client = {
      signUp: vi.fn(async (p: PasskeyProvider, name: string) => {
        await p.create({ user: { id: "dXNlcg", name: name || "Calimero user", displayName: name } });
        return { accountId: "acct-1" };
      }),
    } as unknown as CalimeroClient;
    expect(rememberedSignUpName(CLOUD, storage)).toBe("");
    await signUpHere(client, CLOUD, passkey, {
      name: " Alex ",
      policy: { policy: "open", orgInvites: true, signUpInvites: true, inviteRequired: false, ...POLICY },
      appName: "Sylence",
      storage,
    });
    expect(userOf(create).name).toBe("Alex · Sylence (eu-shared-1 · 3f2a)");
    expect(vi.mocked(client.signUp).mock.calls[0]?.[1]).toBe("Alex");
    expect(rememberedSignUpName(CLOUD, storage)).toBe("Alex");
    expect(rememberedSignUpName(LOCAL, storage)).toBe("");
  });
});
