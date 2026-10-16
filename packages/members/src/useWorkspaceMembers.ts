import { useCallback, useEffect, useRef, useState } from "react";
import type { NamesAdmin } from "@calimero-apps/names";

import { isTeeRole, type MemberRole } from "./roles";

/**
 * The slice of mero-js's `AdminApiClient` the member list reads and writes.
 *
 * Structural, like `NamesAdmin`, so an app passes `useMero().admin` (the
 * session-aware client) or its own wrapper, and this package pins no mero-js.
 *
 * ⚠️ Why the admin client and not mero-react's `useRemoveGroupMembers` /
 * `useUpdateMemberRole`: those hooks resolve to `null` on a refusal and keep
 * the error in state, so a caller awaiting them cannot tell a refused removal
 * from an accepted one in the same tick. The client throws, which is what a
 * list that reports "Couldn't remove Ana: forbidden" needs. The calls are the
 * same ones the hooks make.
 */
export interface MembersAdmin extends NamesAdmin {
  listGroupMembers(groupId: string): Promise<unknown>;
  /** Takes ACCOUNTS (64 hex), the ids the listing keys rows by, never signing keys. */
  removeGroupMembers(groupId: string, request: { members: string[] }): Promise<unknown>;
  /** `identity` is the member's ACCOUNT, as above. */
  updateMemberRole(groupId: string, identity: string, request: { role: string }): Promise<unknown>;
}

export interface WorkspaceMember {
  /** The member's ACCOUNT: what every member call takes. */
  identity: string;
  /** The raw core role: Admin, Member, ReadOnly. */
  role: string;
  /** The name the listing carries (namespace member metadata), if any. */
  name?: string;
}

/** Rows out of whichever shape the node answered with. */
export function parseMembers(raw: unknown): WorkspaceMember[] {
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { members?: unknown })?.members)
      ? (raw as { members: unknown[] }).members
      : Array.isArray((raw as { data?: unknown })?.data)
        ? (raw as { data: unknown[] }).data
        : [];
  return rows.flatMap((row) => {
    const r = row as { identity?: unknown; role?: unknown; name?: unknown; alias?: unknown };
    if (typeof r?.identity !== "string" || !r.identity) return [];
    const name = typeof r.name === "string" ? r.name : typeof r.alias === "string" ? r.alias : undefined;
    return [
      {
        identity: r.identity,
        role: typeof r.role === "string" && r.role ? r.role : "Member",
        ...(name?.trim() ? { name: name.trim() } : {}),
      },
    ];
  });
}

export interface WorkspaceMembers {
  /** People only; TEE nodes are in `teeMembers`. */
  members: WorkspaceMember[];
  teeMembers: WorkspaceMember[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  /** Write the role, then re-read the roster. Throws the node's refusal. */
  setRole: (account: string, role: MemberRole) => Promise<void>;
  /** Remove by ACCOUNT, then re-read the roster. Throws the node's refusal. */
  remove: (account: string) => Promise<void>;
}

/**
 * The members of `groupId`, with the two writes a member list makes.
 *
 * Writes are followed by a read-BACK rather than a local patch: a change the
 * node refused would otherwise look exactly like one it accepted.
 */
export function useWorkspaceMembers(
  admin: MembersAdmin | null | undefined,
  groupId: string | null | undefined,
): WorkspaceMembers {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [teeMembers, setTeeMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Latest request wins: a slow read for the previous workspace must not
  // overwrite the current one.
  const seq = useRef(0);

  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    if (!admin || !groupId) {
      setMembers([]);
      setTeeMembers([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = parseMembers(await admin.listGroupMembers(groupId));
      if (mine !== seq.current) return;
      setMembers(rows.filter((m) => !isTeeRole(m.role)));
      setTeeMembers(rows.filter((m) => isTeeRole(m.role)));
      setError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [admin, groupId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const setRole = useCallback(
    async (account: string, role: MemberRole) => {
      if (!admin || !groupId) throw new Error("Workspace not ready.");
      await admin.updateMemberRole(groupId, account, { role });
      await refetch();
    },
    [admin, groupId, refetch],
  );

  const remove = useCallback(
    async (account: string) => {
      if (!admin || !groupId) throw new Error("Workspace not ready.");
      await admin.removeGroupMembers(groupId, { members: [account] });
      await refetch();
    },
    [admin, groupId, refetch],
  );

  return { members, teeMembers, loading, error, refetch, setRole, remove };
}
