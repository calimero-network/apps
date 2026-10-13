import type { AdminApiClient } from "@calimero-network/mero-js";
import type { OrgBackend } from "../backend";
import { ORG_GROUP_KEY, ORG_KEY, type PlannedOp } from "./types";

export type Executor = Pick<AdminApiClient, "createGroupInNamespace" | "setGroupMetadata" | "addGroupMembers" | "setMemberCapabilities" | "removeGroupMembers" | "createNamespaceInvitation">;
export interface ExecuteResult { applied: number; failed: { op: PlannedOp; error: string }[] }

const INVITATION_TTL_S = 24 * 60 * 60;

export async function execute(ops: PlannedOp[], admin: Executor, backend: OrgBackend, orgNamespaceId: string): Promise<ExecuteResult> {
  const result: ExecuteResult = { applied: 0, failed: [] };
  const stored = new Map((await backend.enrolments()).map((e) => [`${e.account}:${e.app}`, e]));
  // keys whose governance op failed this run: their later `record` ops would overwrite the failure
  const failedKeys = new Set<string>();
  for (const op of ops) {
    if (op.kind === "record" && failedKeys.has(`${op.account}:${op.app}`)) continue;
    try {
      switch (op.kind) {
        case "create-subgroup": {
          const { groupId } = await admin.createGroupInNamespace(op.app, { groupName: op.name, visibility: "restricted" });
          await admin.setGroupMetadata(groupId, { name: op.name, data: { [ORG_GROUP_KEY]: op.orgGroupId, [ORG_KEY]: orgNamespaceId } });
          break;
        }
        case "mint-invitation": {
          const expiresS = Math.floor(Date.now() / 1000) + INVITATION_TTL_S;
          const res = await admin.createNamespaceInvitation(op.app, { expirationTimestamp: expiresS });
          if (!("invitation" in res)) throw new Error("recursive invitation returned where a single one was asked");
          const invitation = JSON.stringify(res.invitation);
          await backend.recordEnrolment({ account: op.account, app: op.app, state: "invitation_pending", invitation, invitationExpires: expiresS * 1000, subgroups: [], note: "" });
          const key = `${op.account}:${op.app}`;
          stored.set(key, { ...(stored.get(key) ?? { account: op.account, app: op.app, subgroups: [], note: "", updated_at: 0 }), state: "invitation_pending", invitation, invitation_expires: expiresS * 1000 });
          break;
        }
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
        case "record": {
          const prev = stored.get(`${op.account}:${op.app}`);
          const keep = op.state === "invitation_pending" && prev?.state === "invitation_pending";
          await backend.recordEnrolment({ account: op.account, app: op.app, state: op.state, invitation: keep ? prev.invitation : "", invitationExpires: keep ? prev.invitation_expires : 0, subgroups: op.subgroups, note: op.note });
          break;
        }
      }
      result.applied += 1;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      result.failed.push({ op, error });
      // The org namespace root is not an app: there is no enrolment row to mark.
      if (op.kind !== "record" && op.kind !== "create-subgroup" && op.app !== orgNamespaceId) {
        const key = `${op.account}:${op.app}`;
        failedKeys.add(key);
        const prev = stored.get(key);
        // A persistent failure writes its row once, not every round.
        if (prev?.state !== "failed" || prev.note !== error) {
          try {
            await backend.recordEnrolment({ account: op.account, app: op.app, state: "failed", invitation: "", invitationExpires: 0, subgroups: [], note: error });
            stored.set(key, { ...(prev ?? { account: op.account, app: op.app, updated_at: 0 }), state: "failed", invitation: "", invitation_expires: 0, subgroups: [], note: error });
          } catch { /* reported in `failed` already */ }
        }
      }
    }
  }
  return result;
}
