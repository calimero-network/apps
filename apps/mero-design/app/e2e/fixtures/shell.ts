import type { Page, Route } from "@playwright/test";
import { TEST_IDENTITY } from "./board";

/**
 * A mocked node for the app shell: teams, each team's boards, members, and the
 * writes the shell makes (create a team or a board, invite, delete, remove a
 * member). Every write is recorded, so a spec can assert what was sent.
 *
 * The board itself answers like `openBoard`'s minimal node: empty, admin role.
 */

export interface MockBoard {
  contextId: string;
  groupId: string;
  name: string;
}

export interface MockTeam {
  id: string;
  name: string;
  boards: MockBoard[];
  members?: { identity: string; role: string; name?: string }[];
}

export interface ShellNode {
  /** Every admin-api write: method, path and JSON body. */
  writes: { method: string; path: string; body: unknown }[];
  teams: MockTeam[];
}

export interface ShellOptions {
  teams: MockTeam[];
  /** Seeds `md-last-visit:<node>` before the app loads. */
  lastVisit?: { team?: string; boards?: Record<string, string>; boardTeams?: Record<string, string> };
}

const NODE = "http://localhost:2430";

export async function mockShellNode(page: Page, opts: ShellOptions): Promise<ShellNode> {
  const node: ShellNode = { writes: [], teams: opts.teams };

  await page.addInitScript(
    ([node, lastVisit]) => {
      localStorage.setItem(
        "mero-tokens",
        JSON.stringify({
          access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LWlkZW50aXR5In0.sig",
          refresh_token: "fake-refresh",
          expires_at: Date.now() + 3600_000,
          node_origin: node,
        }),
      );
      localStorage.setItem("mero:node_url", node);
      localStorage.setItem("mero:application_id", "app-1");
      if (lastVisit && !sessionStorage.getItem("seeded")) {
        localStorage.setItem(`md-last-visit:${node}`, JSON.stringify(lastVisit));
        sessionStorage.setItem("seeded", "1");
      }
    },
    [NODE, opts.lastVisit ?? null] as const,
  );

  const json = (route: Route, data: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
  const allBoards = () => node.teams.flatMap((t) => t.boards);

  await page.route("**/auth/validate", (r) => r.fulfill({ status: 200 }));
  await page.route("**/events**", (r) => r.abort());
  await page.route("**/sse**", (r) => r.abort());
  await page.route("**/admin-api/**", (route) => {
    const req = route.request();
    const method = req.method();
    const path = new URL(req.url()).pathname.replace(/^\/admin-api/, "");
    let m: RegExpMatchArray | null;
    if (method !== "GET") {
      let body: unknown = null;
      try { body = req.postDataJSON(); } catch { body = req.postData(); }
      node.writes.push({ method, path, body });
    }

    if (path === "/identity") return json(route, { data: { accountId: TEST_IDENTITY } });
    // The app is installed: creating a team does not try to install it first.
    if (path === "/applications") return json(route, { data: { apps: [{ id: "app-1", package: "com.calimero.mero-design" }] } });
    if (method === "GET" && (path === "/namespaces" || path.startsWith("/namespaces/for-application/"))) {
      return json(route, { data: node.teams.map((t) => ({ namespaceId: t.id, name: t.name })) });
    }
    if (method === "POST" && path === "/namespaces") {
      const name = (req.postDataJSON() as { name: string }).name;
      const id = `team-${node.teams.length + 1}`;
      node.teams.push({ id, name, boards: [] });
      return json(route, { data: { namespaceId: id } });
    }
    if ((m = path.match(/^\/namespaces\/([^/]+)\/invite$/))) {
      return json(route, { data: { invitation: { invitation: { group_id: [1, 2, 3, 4] }, inviterSignature: "sig" } } });
    }
    if (method === "POST" && (m = path.match(/^\/namespaces\/([^/]+)\/groups$/))) {
      const team = node.teams.find((t) => t.id === m![1]);
      const groupId = `sg-${allBoards().length + 1}`;
      const name = (req.postDataJSON() as { groupName: string }).groupName;
      team?.boards.push({ contextId: "", groupId, name });
      return json(route, { data: { groupId } });
    }
    if (method === "POST" && path === "/contexts") {
      const body = req.postDataJSON() as { groupId: string; name: string };
      const board = allBoards().find((b) => b.groupId === body.groupId);
      const contextId = `ctx-new-${allBoards().length}`;
      if (board) board.contextId = contextId;
      return json(route, { data: { contextId } });
    }
    if (method === "DELETE" && (m = path.match(/^\/contexts\/([^/]+)$/))) {
      for (const t of node.teams) t.boards = t.boards.filter((b) => b.contextId !== m![1]);
      return json(route, { data: {} });
    }
    if ((m = path.match(/^\/groups\/([^/]+)\/subgroups$/))) {
      const team = node.teams.find((t) => t.id === m![1]);
      return json(route, {
        data: { subgroups: (team?.boards ?? []).filter((b) => b.contextId).map((b) => ({ groupId: b.groupId, alias: b.name })) },
      });
    }
    if ((m = path.match(/^\/groups\/([^/]+)\/contexts$/))) {
      const b = allBoards().find((x) => x.groupId === m![1]);
      return json(route, { data: { contexts: b?.contextId ? [{ contextId: b.contextId, name: b.name }] : [] } });
    }
    if (method === "POST" && (m = path.match(/^\/groups\/([^/]+)\/members\/remove$/))) {
      const team = node.teams.find((t) => t.id === m![1]);
      const gone = (req.postDataJSON() as { members: string[] }).members;
      if (team?.members) team.members = team.members.filter((x) => !gone.includes(x.identity));
      return json(route, { data: {} });
    }
    if ((m = path.match(/^\/groups\/([^/]+)\/members$/))) {
      const team = node.teams.find((t) => t.id === m![1]);
      const members = team?.members ?? [{ identity: TEST_IDENTITY, role: "Admin", name: "Tester" }];
      return json(route, { data: { members }, members });
    }
    if (path.endsWith("/metadata")) return json(route, { data: null });
    if (path.match(/^\/contexts\/[^/]+\/identities-owned$/)) return json(route, { data: [TEST_IDENTITY] });
    if (path === "/contexts") return json(route, { data: { contexts: [] } });
    return json(route, { data: {} });
  });

  await page.route("**/jsonrpc", (route) => {
    const body = route.request().postDataJSON() as { id?: number; params?: { method?: string } };
    const method = body?.params?.method ?? "";
    let value: unknown = null;
    if (method === "get_elements" || method === "get_comments" || method === "get_cursors") value = [];
    else if (method === "get_members") value = [{ id: TEST_IDENTITY, username: "Tester", avatar: null, joinedAt: 1 }];
    else if (method === "my_role") value = "admin";
    else if (method === "list_roles") value = [{ member: TEST_IDENTITY, role: "admin" }];
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify(value)));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: body?.id ?? 1, result: { output: bytes, logs: [] } }),
    });
  });

  return node;
}

/** Two teams; the first has two boards. */
export function twoTeams(): MockTeam[] {
  return [
    {
      id: "team-a",
      name: "Studio",
      boards: [
        { contextId: "ctx-a1", groupId: "sg-a1", name: "Poster" },
        { contextId: "ctx-a2", groupId: "sg-a2", name: "Flyer" },
      ],
    },
    { id: "team-b", name: "Marketing", boards: [{ contextId: "ctx-b1", groupId: "sg-b1", name: "Launch" }] },
  ];
}
