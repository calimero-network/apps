import type { FeedItem, LinkView } from "./generated/HyperfeedClient";
import type { LensHost } from "./lens/lens";

/**
 * Where each first-party app lives on the web, by app key: the `frontend` its
 * logic/Cargo.toml declares. Only these get your session handed over, so a
 * row can never send your node's tokens anywhere else.
 */
export const FRONTENDS: Record<string, string> = {
  chat: "https://mero-chat-pwa.vercel.app",
  design: "https://mero-design.vercel.app",
  calendar: "https://mero-calendar.vercel.app",
  sheets: "https://mero-sheets.vercel.app",
  "issue-tracker": "https://mero-issue-tracker-app.vercel.app",
  issues: "https://mero-issue-tracker-app.vercel.app",
  crm: "https://mero-crm.vercel.app",
  sign: "https://mero-sign-eta.vercel.app",
  "drive-docs": "https://mero-docs.vercel.app",
  docs: "https://mero-docs.vercel.app",
  updates: "https://mero-updates.vercel.app",
  vote: "https://mero-vote.vercel.app",
  pass: "https://mero-pass.vercel.app",
  forum: "https://mero-forum.vercel.app",
  stream: "https://mero-stream-neon.vercel.app",
  pixart: "https://mero-pixart.vercel.app",
  blocks: "https://mero-blocks.vercel.app",
  "kv-store": "https://mero-kv-store.vercel.app",
};

/** Your session on your node, as the apps' login hash takes it. */
export interface Session {
  nodeUrl: string;
  accessToken: string;
  refreshToken: string;
}

/** What opening a row needs beyond the row: who you are, and where its context sits. */
export interface LinkContext {
  session: Session | null;
  /** The application the row's context runs. */
  applicationId?: string;
  /** The group (namespace) the row's context belongs to: mero-design files documents under it. */
  groupId?: string;
}

/** Whether a row has an app to open: a first-party app and the context it happened in. */
export function canOpen(item: FeedItem): boolean {
  return Boolean(item.app && item.source_context && FRONTENDS[item.app]);
}

/**
 * The address that shows a row where it happened: Chat at its channel, Design
 * at its document, any other app at its context. Signed in when there is a
 * session, so it opens straight onto the thing instead of a login.
 */
export function appLink(item: FeedItem, ctx: LinkContext): string | null {
  const base = FRONTENDS[item.app]?.replace(/\/+$/, "");
  if (!base || !item.source_context) return null;
  const context = encodeURIComponent(item.source_context);
  const where =
    item.app === "design"
      ? ctx.groupId
        ? `/teams/${encodeURIComponent(ctx.groupId)}/projects/${context}`
        : "/"
      : `/?context-id=${context}`;
  if (!ctx.session) return base + where;
  const hash = new URLSearchParams({
    access_token: ctx.session.accessToken,
    refresh_token: ctx.session.refreshToken,
    node_url: ctx.session.nodeUrl,
    ...(ctx.applicationId ? { application_id: ctx.applicationId } : {}),
  });
  return `${base}${where}#${hash.toString()}`;
}

/**
 * A link between a chat and a task started from it (`hyperfeed:task:<chain>`
 * on the chat, `hyperfeed:from:<chain>` on the task): the other chain, which
 * way it points, and what it says. null for a link to another app.
 */
export function chainLink(link: Pick<LinkView, "app" | "context" | "item" | "label">): { chain: string; started: boolean; label: string } | null {
  if (link.app !== "hyperfeed" || !link.item || (link.context !== "task" && link.context !== "from")) return null;
  const started = link.context === "task";
  return { chain: link.item, started, label: `${started ? "Started" : "From"}: ${link.label || (started ? "a task" : "a chat")}` };
}

/**
 * The subject (`<app>:<context>[:<id>]`) a link you paste names: an app's
 * address (`…/?context-id=…`, Design's `…/projects/<context>`), or a subject
 * as is. `""` for anything else.
 */
export function subjectFromLink(text: string): string {
  const raw = text.trim();
  if (/^[a-z0-9.-]+:[^\s:/]+(?::\S+)?$/.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  // The first key per address is its own: `issue-tracker`, not its alias `issues`.
  const app = Object.keys(FRONTENDS).find((k) => new URL(FRONTENDS[k]!).origin === url.origin);
  const context = url.searchParams.get("context-id") ?? /\/projects\/([^/?#]+)/.exec(url.pathname)?.[1] ?? "";
  if (!app || !context) return "";
  const item = url.searchParams.get("issue") ?? url.searchParams.get("doc") ?? "";
  return item ? `${app}:${decodeURIComponent(context)}:${item}` : `${app}:${decodeURIComponent(context)}`;
}

/**
 * What a link's chip is called, read from the thing itself ("#launch", "DM
 * with Ronit"); `""` when it cannot say, and the chip names itself as before.
 * A link the agent made is unlabelled: without this, every chat it touched
 * read "Chat".
 */
export type NameLink = (link: Pick<LinkView, "app" | "context" | "item">) => Promise<string>;

/**
 * What a whole chat is called: a channel by its name; a DM, whose own name is
 * the frontend's "private_dm", by the people in it besides you.
 */
export async function chatName(host: LensHost): Promise<string> {
  const info = await host.call<{ name?: string; context_type?: string }>("get_info", {});
  if (info?.context_type !== "Dm") return info?.name ? `#${info.name}` : "";
  const [mine, profiles] = await Promise.all([host.me(), host.call<{ identity: string; username?: string }[]>("get_profiles", {})]);
  const others = (Array.isArray(profiles) ? profiles : []).filter((p) => !mine.has(p.identity));
  const names = (await Promise.all(others.map(async (p) => (await host.name(p.identity)) || p.username?.trim() || ""))).filter(Boolean);
  return names.length > 0 ? `DM with ${names.join(", ")}` : "DM";
}

/**
 * Names whole-chat links from the chat, each context read once; a failed read
 * is asked again next time. A thread, another app, or a context no host
 * reaches: `""`.
 */
export function linkNamer(hostFor: (contextId: string) => LensHost | null): NameLink {
  const named = new Map<string, Promise<string>>();
  return (link) => {
    if (link.app !== "chat" || link.item || !link.context) return Promise.resolve("");
    let name = named.get(link.context);
    if (!name) {
      const host = hostFor(link.context);
      if (!host) return Promise.resolve("");
      name = chatName(host).catch(() => {
        named.delete(link.context);
        return "";
      });
      named.set(link.context, name);
    }
    return name;
  };
}
