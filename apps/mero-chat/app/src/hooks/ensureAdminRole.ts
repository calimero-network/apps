import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";

/**
 * A namespace admin needs the Admin role in each channel's contract;
 * set_member_role lets them promote themselves while no admin exists yet.
 * This used to send that write on every chat switch, where the contract
 * answers "Role unchanged" after the first time. Now it reads the role once
 * per channel per session and writes only when it is not Admin yet.
 */
const checked = new Set<string>();

export async function ensureAdminRole(
  contextId: string,
  contextIdentity: string,
  selfAccount: string,
  api: Pick<ClientApiDataSource, "getMemberRole" | "setMemberRole"> = new ClientApiDataSource(),
): Promise<void> {
  if (checked.has(contextId)) return;
  checked.add(contextId);
  const role = await api.getMemberRole({ contextId, executorPublicKey: contextIdentity, identity: selfAccount });
  if (role.error) {
    // Not readable yet (e.g. the context is still joining): try again next time.
    checked.delete(contextId);
    return;
  }
  if (role.data === "Admin") return;
  await api.setMemberRole({ contextId, executorPublicKey: contextIdentity, target: selfAccount, role: "Admin" });
}

/** Test hook. */
export function resetEnsureAdminRole() {
  checked.clear();
}
