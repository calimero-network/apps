import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseLens, runLens, type LensHost } from "./lens";
import { validateLens, type Abi } from "./validate";

const APPS = path.resolve(__dirname, "../../../..");
const abi = JSON.parse(readFileSync(path.join(APPS, "mero-pass/logic/res/abi.json"), "utf8")) as Abi;
const lens = parseLens(readFileSync(path.join(__dirname, "fixtures", "pass.json"), "utf8"));

// Accounts as mero-pass writes them (`created_by`, an audit line's `account`): AccountId, hex.
const ME_HEX = "11".repeat(32);
const MAYA = "22".repeat(32);
const ME = new Set([ME_HEX, "me-b58"]);
const SOURCE = { contextId: "ctx-pass", appKey: "pass", label: "pass · ctx-pa" };
const SECRET = `secret_${"ab".repeat(16)}`;

type Audit = { action: string; target: string; account: string };

/** mero-pass as the lens sees it: one secret, the audit trail newest first, the vault. */
function passHost(createdBy: string, audit: Audit[], { exists = true, myRole = "editor" } = {}): LensHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    me: async () => ME,
    name: async (id) => (id === MAYA ? "Maya" : ""),
    call: async <T,>(method: string, args: Record<string, unknown>) => {
      calls.push(method);
      switch (method) {
        case "get_secret":
          if (!exists || args.id !== SECRET) return null as T;
          return {
            id: SECRET,
            kind: "login",
            name: "enc:v1:NAME-CIPHERTEXT",
            tags: "enc:v1:TAGS-CIPHERTEXT",
            fields: { password: "enc:v1:PASSWORD-CIPHERTEXT", url: "enc:v1:URL-CIPHERTEXT" },
            created_at: 1_780_000_000_000_000_000,
            created_by: createdBy,
            updated_at: 1_790_000_000_000_000_000,
            updated_by: audit[0]?.account ?? createdBy,
            trashed: audit[0]?.action === "secret_trashed",
            trashed_at: 0,
          } as T;
        case "get_audit_logs":
          return audit.map((a, i) => ({ ...a, device: "00".repeat(32), timestamp: 1_790_000_000_000_000_000 - i, redacted: false })) as T;
        case "vault_info":
          return { name: "Bank logins", current_key: "key-1", default_role: "editor", my_account: ME_HEX, my_role: myRole } as T;
      }
      throw new Error(`no method ${method}`);
    },
  };
}

describe("pass lens", () => {
  it("passes validation against mero-pass's ABI", () => {
    expect(validateLens(lens, abi)).toEqual([]);
  });

  it("records someone else changing a secret you created, without any ciphertext", async () => {
    const host = passHost(ME_HEX, [{ action: "secret_updated", target: SECRET, account: MAYA }]);
    const out = await runLens(lens, "SecretChanged", { secret_id: SECRET }, SOURCE, host);
    expect(out.kind).toBe("recorded");
    if (out.kind !== "recorded") return;
    expect(out.reading).toMatchObject({
      item_type: "change",
      title: "Changed your login",
      body: "Edited it",
      from: "Maya",
      source_label: "Bank logins",
      needs_you: false,
      reply_call: "",
    });
    const fields = JSON.parse(out.reading.fields);
    expect(fields).toEqual({ from: "Maya", from_id: MAYA, what: "your login", summary: "Edited it", where: "Bank logins" });
    expect(JSON.stringify(out.reading)).not.toMatch(/CIPHERTEXT/);

    const trashed = await runLens(lens, "SecretChanged", { secret_id: SECRET }, SOURCE, passHost(ME_HEX, [{ action: "secret_trashed", target: SECRET, account: MAYA }]));
    expect(trashed.kind === "recorded" && trashed.reading.title).toBe("Trashed your login");
  });

  it("skips your own change, a secret that is not yours, a rekey, a purge and a stale trail", async () => {
    const run = (host: LensHost) => runLens(lens, "SecretChanged", { secret_id: SECRET }, SOURCE, host);
    expect((await run(passHost(ME_HEX, [{ action: "secret_updated", target: SECRET, account: "me-b58" }]))).kind).toBe("skipped");
    expect((await run(passHost(MAYA, [{ action: "secret_updated", target: SECRET, account: MAYA }]))).kind).toBe("skipped");
    expect((await run(passHost(ME_HEX, [{ action: "secret_rekeyed", target: SECRET, account: MAYA }]))).kind).toBe("skipped");
    expect((await run(passHost(ME_HEX, [{ action: "secret_purged", target: SECRET, account: MAYA }], { exists: false }))).kind).toBe("skipped");
    expect((await run(passHost(ME_HEX, [{ action: "secret_updated", target: "secret_other", account: MAYA }]))).kind).toBe("skipped");
  });

  it("records an admin changing your role, not a change to someone else's or your own", async () => {
    const out = await runLens(lens, "MembersChanged", null, SOURCE, passHost(MAYA, [{ action: "role_set:viewer", target: ME_HEX, account: MAYA }], { myRole: "viewer" }));
    expect(out.kind).toBe("recorded");
    if (out.kind !== "recorded") return;
    expect(out.reading).toMatchObject({ item_type: "status", title: "Your vault role changed", body: "You are now viewer in Bank logins", needs_you: false });
    const other = await runLens(lens, "MembersChanged", null, SOURCE, passHost(MAYA, [{ action: "role_set:editor", target: "33".repeat(32), account: MAYA }]));
    expect(other.kind).toBe("skipped");
    const own = await runLens(lens, "MembersChanged", null, SOURCE, passHost(MAYA, [{ action: "role_set:admin", target: ME_HEX, account: ME_HEX }]));
    expect(own.kind).toBe("skipped");
  });

  it("ignores key and rename bookkeeping", async () => {
    const host = passHost(ME_HEX, []);
    expect(await runLens(lens, "KeysChanged", null, SOURCE, host)).toEqual({ kind: "skipped", why: "KeysChanged is ignored" });
    expect((await runLens(lens, "VaultRenamed", null, SOURCE, host)).kind).toBe("skipped");
    expect(host.calls).toEqual([]);
  });
});
