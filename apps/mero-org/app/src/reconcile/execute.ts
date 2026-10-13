import type { AdminApiClient } from "@calimero-network/mero-js";
import type { OrgBackend } from "../backend";
import { ORG_GROUP_KEY, ORG_KEY, type PlannedOp } from "./types";

export type Executor = Pick<AdminApiClient, "createGroupInNamespace" | "setGroupMetadata" | "addGroupMembers" | "setMemberCapabilities" | "removeGroupMembers">;
export interface ExecuteResult { applied: number; failed: { op: PlannedOp; error: string }[] }

/** The enrolment an op acts for, or null for one that acts for no person. */
function keyOf(op: PlannedOp): string | null {
  return op.kind === "create-subgroup" || op.kind === "set-app-peers" ? null : `${op.account}:${op.app}`;
}

export async function execute(ops: PlannedOp[], admin: Executor, backend: OrgBackend, orgNamespaceId: string): Promise<ExecuteResult> {
  const result: ExecuteResult = { applied: 0, failed: [] };
  const stored = new Map((await backend.enrolments()).map((e) => [`${e.account}:${e.app}`, e]));
  // keys whose governance op failed this run: their later `record` ops would overwrite the failure
  const failedKeys = new Set<string>();
  for (const op of ops) {
    // After a person's first failure, their later ops for that app would fail on it too
    // (a subgroup add needs the root add) and bury the first error under theirs.
    const opKey = keyOf(op);
    if (opKey && failedKeys.has(opKey)) continue;
    try {
      switch (op.kind) {
        case "create-subgroup": {
          const { groupId } = await admin.createGroupInNamespace(op.app, { groupName: op.name, visibility: "restricted" });
          await admin.setGroupMetadata(groupId, { name: op.name, data: { [ORG_GROUP_KEY]: op.orgGroupId, [ORG_KEY]: orgNamespaceId } });
          break;
        }
        case "add-root-member":
          await admin.addGroupMembers(op.app, { members: [{ identity: op.account, role: "Member" }] });
          break;
        case "set-app-peers":
          await backend.setAppPeers(op.app, op.peerAddrs);
          break;
        case "add-member":
          await admin.addGroupMembers(op.subgroupId, { members: [{ identity: op.account, role: "Member" }] });
          await admin.setMemberCapabilities(op.subgroupId, op.account, { capabilities: op.capabilities });
          break;
        case "set-capabilities":
          await admin.setMemberCapabilities(op.subgroupId, op.account, { capabilities: op.capabilities });
          break;
        case "remove-member":
          await admin.removeGroupMembers(op.subgroupId, { members: [op.account] });
          break;
        case "record":
          await backend.recordEnrolment({ account: op.account, app: op.app, state: op.state, subgroups: op.subgroups, note: op.note });
          break;
      }
      result.applied += 1;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      result.failed.push({ op, error });
      // The org namespace root is not an app: there is no enrolment row to mark.
      if (op.kind !== "record" && "account" in op && op.app !== orgNamespaceId) {
        const key = `${op.account}:${op.app}`;
        failedKeys.add(key);
        const prev = stored.get(key);
        // A persistent failure writes its row once, not every round.
        if (prev?.state !== "failed" || prev.note !== error) {
          try {
            await backend.recordEnrolment({ account: op.account, app: op.app, state: "failed", subgroups: [], note: error });
            stored.set(key, { ...(prev ?? { account: op.account, app: op.app, updated_at: 0 }), state: "failed", subgroups: [], note: error });
          } catch { /* reported in `failed` already */ }
        }
      }
    }
  }
  return result;
}
