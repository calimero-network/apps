import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseLens, runLens, type LensHost } from "./lens";
import { validateLens, type Abi } from "./validate";

const APPS = path.resolve(__dirname, "../../../..");
const abi = JSON.parse(readFileSync(path.join(APPS, "mero-sign/logic/res/abi.json"), "utf8")) as Abi;
const lens = parseLens(readFileSync(path.join(__dirname, "fixtures", "sign.json"), "utf8"));

// mero-sign's `UserId` is a raw `[u8; 32]`: serde writes it, in event payloads
// and in read results alike, as an array of 32 numbers, never as a string.
const bytes = (b: number) => Array.from({ length: 32 }, () => b);
const ME = bytes(0x11);
const MAYA = bytes(0x22);
const PRIYA = bytes(0x33);
// The host's identities are strings (hex and base58); they never match a byte array.
const ME_IDS = new Set(["11".repeat(32), "me-b58"]);
const SOURCE = { contextId: "ab".repeat(32), appKey: "sign", label: "sign · ctx-ab" };

type Level = "Read" | "Sign" | "Admin";

/** mero-sign as the lens sees it, answering the read-only methods it calls. */
function signHost(participants: [number[], Level][], { isPrivate = false } = {}): LensHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    me: async () => ME_IDS,
    name: async () => "",
    call: async <T,>(method: string, args: Record<string, unknown>) => {
      calls.push(method);
      const answer = (() => {
        switch (method) {
          case "whoami":
            return ME;
          case "get_context_details":
            expect(args).toEqual({ context_id_str: SOURCE.contextId });
            return {
              context_id: bytes(0xab),
              context_name: "Lease 2026",
              owner: MAYA,
              is_private: isPrivate,
              participant_count: participants.length,
              participants: participants.map(([user_id, permission_level]) => ({ user_id, permission_level })),
              document_count: 1,
              created_at: 1_760_000_000_000_000_000,
            };
        }
        throw new Error(`no method ${method}`);
      })();
      return answer as T;
    },
  };
}

const PARTIES: [number[], Level][] = [
  [MAYA, "Admin"],
  [ME, "Sign"],
  [PRIYA, "Read"],
];

describe("sign lens", () => {
  it("is valid against mero-sign's ABI", () => {
    expect(validateLens(lens, abi)).toEqual([]);
  });

  it("asks you to sign a document someone else uploaded", async () => {
    const host = signHost(PARTIES);
    const out = await runLens(lens, "DocumentUploaded", { id: "doc_ab12", name: "Lease.pdf", uploaded_by: MAYA }, SOURCE, host);
    expect(out.kind).toBe("recorded");
    if (out.kind !== "recorded") return;
    expect(out.reading).toMatchObject({
      item_type: "request",
      title: "Waiting for your signature: Lease.pdf",
      body: "New document in Lease 2026. Open it in Sign to review, consent and sign.",
      source_label: "Lease 2026",
      needs_you: true,
      reply_call: "",
    });
    expect(out.reading.ask.kind).toBe("");
    expect(JSON.parse(out.reading.fields)).toMatchObject({ asks_for: "sign Lease.pdf", where: "Lease 2026" });
  });

  it("skips your own upload, and a document you only view", async () => {
    const own = await runLens(lens, "DocumentUploaded", { id: "doc_1", name: "Mine.pdf", uploaded_by: ME }, SOURCE, signHost(PARTIES));
    expect(own).toEqual({ kind: "skipped", why: "not for you" });
    const viewer = await runLens(
      lens,
      "DocumentUploaded",
      { id: "doc_2", name: "Lease.pdf", uploaded_by: MAYA },
      SOURCE,
      signHost([
        [MAYA, "Admin"],
        [ME, "Read"],
      ]),
    );
    expect(viewer).toEqual({ kind: "skipped", why: "not for you" });
    const outsider = await runLens(lens, "DocumentUploaded", { id: "doc_3", name: "Lease.pdf", uploaded_by: MAYA }, SOURCE, signHost([[MAYA, "Admin"]]));
    expect(outsider).toEqual({ kind: "skipped", why: "not for you" });
  });

  it("tells you your permission changed, and only yours", async () => {
    const out = await runLens(lens, "ParticipantPermissionChanged", { user_id: ME, permission: "Admin" }, SOURCE, signHost(PARTIES));
    expect(out.kind).toBe("recorded");
    if (out.kind !== "recorded") return;
    expect(out.reading).toMatchObject({
      item_type: "status",
      title: "Your permission in Lease 2026 is now Admin",
      needs_you: false,
      reply_call: "",
    });
    const other = await runLens(lens, "ParticipantPermissionChanged", { user_id: PRIYA, permission: "Sign" }, SOURCE, signHost(PARTIES));
    expect(other).toEqual({ kind: "skipped", why: "not for you" });
  });

  it("tells you when you were removed", async () => {
    const out = await runLens(lens, "ParticipantLeft", { user_id: ME }, SOURCE, signHost([[MAYA, "Admin"]]));
    expect(out.kind).toBe("recorded");
    if (out.kind !== "recorded") return;
    expect(out.reading).toMatchObject({ item_type: "status", title: "Removed from Lease 2026" });
  });

  it("ignores bookkeeping without reading anything", async () => {
    const host = signHost(PARTIES);
    for (const [kind, payload] of [
      ["DocumentSigned", { document_id: "doc_ab12", signer: MAYA }],
      ["ParticipantJoined", { user_id: ME }],
      ["SignatureCreated", { id: 1, name: "My signature", size: 2048 }],
    ] as const) {
      expect(await runLens(lens, kind, payload, SOURCE, host)).toEqual({ kind: "skipped", why: `${kind} is ignored` });
    }
    expect(host.calls).toEqual([]);
  });
});
