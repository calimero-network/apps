/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { describeError } from "@calimero-apps/connect";

import { connection } from "./connection";
import { setConversations, setMembers, setPrivateRoster } from "./registry";
import {
  createChannel as createChannelApp,
  inviteLink,
  inviteToken,
  listConversations,
  listMembers,
  listWorkspaces,
  openDm as openDmApp,
  privateMembers,
  setPrivateMember as setPrivateMemberApp,
  type Conversation,
  type Member,
  type Workspace,
} from "./workspace";
import { nameRepository } from "../repositories/names/useNames";
import { getMessengerDisplayName } from "../utils/messengerName";

/** How often the workspace (members, conversations) is read again. */
export const WORKSPACE_POLL_MS = 30_000;

export interface WorkspaceState {
  org: string;
  /** Every workspace the account is in (the switcher). */
  workspaces: Workspace[];
  name: string;
  /** The caller's role in the org: `owner` and `admin` administer it. */
  role: Workspace["role"] | null;
  members: Member[];
  conversations: Conversation[];
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  /** A channel; answers its app id. */
  createChannel(name: string, isPrivate: boolean, description?: string): Promise<string>;
  /** The DM with `account`, created when there is none; answers its app id. */
  openDm(account: string): Promise<string>;
  /** An invitation link into the workspace (a passkey step-up). */
  invite(role: "member" | "admin" | "guest"): Promise<string>;
  /** Removes `account` from the workspace (owner/admins, a passkey step-up). */
  removeMember(account: string): Promise<void>;
  /** Changes `account`'s org role (owner/admins, a passkey step-up). */
  setMemberRole(account: string, role: "member" | "admin" | "guest"): Promise<void>;
  /** Adds or removes a member of a private channel (its creator or an org admin). */
  setPrivateMember(app: string, account: string, add: boolean): Promise<void>;
  /** Deletes a channel (its creator or an org admin). */
  deleteConversation(app: string): Promise<void>;
  /** The name the caller goes by in this workspace. */
  setMyName(name: string): Promise<void>;
  /** Opens another workspace; `""` goes back to the picker. */
  switchTo(org: string): void;
  /** Ends the session. */
  signOut(): void;
}

const Ctx = createContext<WorkspaceState | null>(null);

export function useWorkspace(): WorkspaceState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace must be used inside a WorkspaceProvider");
  return v;
}

/** `null` outside a workspace (the components that read it degrade). */
export function useMaybeWorkspace(): WorkspaceState | null {
  return useContext(Ctx);
}

export function WorkspaceProvider({
  org,
  onSwitch,
  onSignOut,
  children,
}: {
  org: string;
  onSwitch: (org: string) => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [members, setMemberList] = useState<Member[]>([]);
  const [conversations, setConversationList] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const conn = connection();
    try {
      const [ws, ms, cs] = await Promise.all([
        listWorkspaces(conn.client),
        listMembers(conn.client, org),
        listConversations(conn.client, conn.source, org, conn.accountId),
      ]);
      setMembers(ms);
      setConversations(cs);
      // Private channels: who they reach (one read each).
      await Promise.all(
        cs
          .filter((c) => c.kind === "private")
          .map(async (c) => setPrivateRoster(c.appId, await privateMembers(conn.client, c.appId).catch(() => []))),
      );
      setWorkspaces(ws);
      setMemberList(ms);
      setConversationList(cs);
      setError(null);
      nameRepository.invalidate();
    } catch (e) {
      setError(describeError(e));
    } finally {
      conn.after();
      setLoading(false);
    }
  }, [org]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), WORKSPACE_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const step = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T> => {
      const conn = connection();
      try {
        return await run();
      } finally {
        conn.after();
      }
    },
    [],
  );

  const value = useMemo<WorkspaceState>(() => {
    const me = connection().accountId;
    const ws = workspaces.find((w) => w.orgId === org);
    const role = members.find((m) => m.account === me)?.role ?? ws?.role ?? null;
    const username = () =>
      members.find((m) => m.account === me)?.name || getMessengerDisplayName() || "";
    return {
      org,
      workspaces,
      name: ws?.name ?? "",
      role,
      members,
      conversations,
      loading,
      error,
      refresh,
      createChannel: (name, isPrivate, description) =>
        step(async () => {
          const conn = connection();
          const app = await createChannelApp(conn.client, conn.source, org, name, isPrivate, username(), description);
          await refresh();
          return app;
        }),
      openDm: (account) =>
        step(async () => {
          const conn = connection();
          const app = await openDmApp(conn.client, conn.source, conversations, org, me, account, username());
          await refresh();
          return app;
        }),
      invite: (r) =>
        step(async () => {
          const conn = connection();
          return inviteLink(await inviteToken(conn.client, org, r, conn.passkey()));
        }),
      removeMember: (account) =>
        step(async () => {
          const conn = connection();
          await conn.client.removeMember(org, account, conn.passkey());
          await refresh();
        }),
      setMemberRole: (account, r) =>
        step(async () => {
          const conn = connection();
          await conn.client.setMember(org, account, r, conn.passkey());
          await refresh();
        }),
      setPrivateMember: (app, account, add) =>
        step(async () => {
          await setPrivateMemberApp(connection().client, app, account, add);
          await refresh();
        }),
      deleteConversation: (app) =>
        step(async () => {
          await connection().client.deleteApp(app);
          await refresh();
        }),
      setMyName: (name) =>
        step(async () => {
          await connection().client.setMemberMetadata(org, me, { name });
          await refresh();
        }),
      switchTo: onSwitch,
      signOut: onSignOut,
    };
  }, [org, workspaces, members, conversations, loading, error, refresh, step, onSwitch, onSignOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
