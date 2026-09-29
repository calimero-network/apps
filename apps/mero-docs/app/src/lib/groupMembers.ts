// `listGroupMembers` rows as the node sends them: some node versions wrap the
// list in `data` (see useFolderMembership).
export interface MemberRow {
  identity: string;
  role?: string;
}

export async function listMembers(
  admin: { listGroupMembers(groupId: string): Promise<unknown> },
  group: string,
): Promise<MemberRow[]> {
  const raw = (await admin.listGroupMembers(group)) as { members?: MemberRow[]; data?: MemberRow[] };
  return raw.members ?? raw.data ?? [];
}
