import type { FeedItem } from "./generated/HyperfeedClient";

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
