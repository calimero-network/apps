// Admin-API helpers for the web flow: resolve the installed application,
// list joinable worlds (contexts), create a new world. Response envelopes
// vary across node versions, so every parser is shape-tolerant (the
// mero-design `res.identities ?? res.items ?? res` school of parsing).

import { getAccessToken, getSession, updateSession } from "./session";
import { PACKAGE_NAME } from "./auth";

export interface ContextInfo {
  contextId: string;
  applicationId: string;
}

function headers(): Record<string, string> {
  const token = getAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function adminGet<T = unknown>(path: string): Promise<T> {
  const { nodeUrl } = getSession();
  const res = await fetch(`${nodeUrl}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  const body = await res.json();
  return (body?.data ?? body) as T;
}

async function adminPost<T = unknown>(path: string, payload: unknown): Promise<T> {
  const { nodeUrl } = getSession();
  const res = await fetch(`${nodeUrl}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`POST ${path}: HTTP ${res.status}`);
  const body = await res.json();
  return (body?.data ?? body) as T;
}

/** unwrap {apps: []} | {applications: []} | [] */
export function parseApplications(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const obj = (data ?? {}) as Record<string, unknown>;
  for (const key of ["apps", "applications", "items"]) {
    if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
  }
  return [];
}

/** unwrap {contexts: []} | [] and normalize id fields */
export function parseContexts(data: unknown): ContextInfo[] {
  let list: Record<string, unknown>[] = [];
  if (Array.isArray(data)) list = data as Record<string, unknown>[];
  else {
    const obj = (data ?? {}) as Record<string, unknown>;
    for (const key of ["contexts", "items"]) {
      if (Array.isArray(obj[key])) {
        list = obj[key] as Record<string, unknown>[];
        break;
      }
    }
  }
  return list
    .map((c) => ({
      contextId: String(c.contextId ?? c.id ?? ""),
      applicationId: String(c.applicationId ?? c.application_id ?? ""),
    }))
    .filter((c) => c.contextId);
}

/** the package id of an application record, wherever this node version put it */
export function packageOf(app: Record<string, unknown>): string {
  const direct = app.package ?? app.packageName ?? app.package_name;
  if (typeof direct === "string" && direct) return direct;
  const manifest = app.manifest as Record<string, unknown> | undefined;
  if (manifest && typeof manifest.package === "string") return manifest.package;
  // some versions serialize metadata as bytes of the manifest json
  if (Array.isArray(app.metadata)) {
    try {
      const text = new TextDecoder().decode(new Uint8Array(app.metadata as number[]));
      const parsed = JSON.parse(text);
      if (typeof parsed?.package === "string") return parsed.package;
    } catch {
      /* metadata was not manifest json */
    }
  }
  return "";
}

const appId = (app: Record<string, unknown>): string =>
  String(app.id ?? app.applicationId ?? app.application_id ?? "");

/**
 * Application id: session (URL hash wins — the mero-chat lesson) > installed
 * app matching our package name > lone installed app.
 */
export async function resolveApplicationId(): Promise<string | null> {
  const s = getSession();
  if (s.applicationId) return s.applicationId;
  const apps = parseApplications(await adminGet("/admin-api/applications"));
  const match = apps.find((a) => packageOf(a) === PACKAGE_NAME);
  const chosen = match ?? (apps.length === 1 ? apps[0] : undefined);
  const id = chosen ? appId(chosen) : "";
  if (id) updateSession({ applicationId: id });
  return id || null;
}

/** worlds this node can enter (contexts of our application) */
export async function listWorlds(applicationId: string | null): Promise<ContextInfo[]> {
  const contexts = parseContexts(await adminGet("/admin-api/contexts"));
  if (!applicationId) return contexts;
  // keep contexts with unknown applicationId — old nodes omit the field
  return contexts.filter((c) => !c.applicationId || c.applicationId === applicationId);
}

/** create a fresh world context; returns its id + my member key */
export async function createWorld(
  applicationId: string,
  name: string,
  seed: number,
): Promise<{ contextId: string; memberPublicKey: string }> {
  const initializationParams = Array.from(
    new TextEncoder().encode(
      JSON.stringify({ name, seed, now: Math.floor(Date.now() / 1000) }),
    ),
  );
  const data = await adminPost<Record<string, unknown>>("/admin-api/contexts", {
    applicationId,
    protocol: "near",
    initializationParams,
  });
  return {
    contextId: String(data.contextId ?? data.id ?? ""),
    memberPublicKey: String(data.memberPublicKey ?? data.member_public_key ?? ""),
  };
}

/** join a context this node knows about (idempotent on most versions) */
export async function joinContext(contextId: string): Promise<void> {
  try {
    await adminPost(`/admin-api/contexts/${contextId}/join`, {});
  } catch {
    /* already joined / older node without the route — the rpc calls decide */
  }
}
