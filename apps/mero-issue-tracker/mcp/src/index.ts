#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, type Config } from './config.ts';
import {
  callMethod,
  connect,
  createRepoLister,
  createTargetResolver,
  describe,
  findWorkspace,
  listWorkspaceRepos,
  viewMethod,
  type Client,
  type ResolvedTarget,
  type WorkspaceRepo,
} from './node.ts';
import { buildFixPrompt, type IssueForPrompt } from './fixPrompt.ts';

// A repo (by name) to target within the workspace; defaults to
// TRACKER_REPO, else the workspace's only repo.
const repoParam = z
  .string()
  .optional()
  .describe("Repo (by name) to target; defaults to TRACKER_REPO or the workspace's only repo.");

// ---- Tool input schemas ----

export const createIssueShape = {
  title: z.string().min(1, 'title is required'),
  summary: z.string().min(1, 'summary is required'),
  impact: z.string().min(1, 'impact is required'),
  repro: z.string().min(1, 'repro is required'),
  resolution_criteria: z.string().min(1, 'resolution_criteria is required'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  labels: z.array(z.string()).default([]),
  repo: repoParam,
};

export const listIssuesShape = {
  status: z.string().optional(),
  assignee: z.string().optional(),
  label: z.string().optional(),
  repo: repoParam,
};

export const getIssueShape = {
  id: z.string().min(1, 'id is required'),
  repo: repoParam,
};

export const addCommentShape = {
  issue_id: z.string().min(1, 'issue_id is required'),
  body: z.string().min(1, 'body is required'),
  repo: repoParam,
};

export const assignIssueShape = {
  issue_id: z.string().min(1, 'issue_id is required'),
  assignee: z.string().min(1, 'assignee is required'),
  repo: repoParam,
};

export const setStatusShape = {
  issue_id: z.string().min(1, 'issue_id is required'),
  status: z.enum(['Open', 'In progress', 'Blocked', 'Done']),
  repo: repoParam,
};

export const setPriorityShape = {
  issue_id: z.string().min(1, 'issue_id is required'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  repo: repoParam,
};

export const deleteIssueShape = {
  issue_id: z.string().min(1, 'issue_id is required'),
  repo: repoParam,
};

export const getFixPromptShape = {
  id: z.string().min(1, 'id is required'),
  repo: repoParam,
};

export const listReposShape = {};

export const addRepoShape = {
  name: z.string().min(1, 'name is required'),
  github_url: z
    .string()
    .min(1, 'github_url is required')
    .refine((u) => /^https?:\/\//.test(u.trim()), 'github_url must start with http:// or https://'),
};

type CreateIssueArgs = z.infer<z.ZodObject<typeof createIssueShape>>;
type ListIssuesArgs = z.infer<z.ZodObject<typeof listIssuesShape>>;
type GetIssueArgs = z.infer<z.ZodObject<typeof getIssueShape>>;
type AddCommentArgs = z.infer<z.ZodObject<typeof addCommentShape>>;
type AssignIssueArgs = z.infer<z.ZodObject<typeof assignIssueShape>>;
type SetStatusArgs = z.infer<z.ZodObject<typeof setStatusShape>>;
type SetPriorityArgs = z.infer<z.ZodObject<typeof setPriorityShape>>;
type DeleteIssueArgs = z.infer<z.ZodObject<typeof deleteIssueShape>>;
type GetFixPromptArgs = z.infer<z.ZodObject<typeof getFixPromptShape>>;
type AddRepoArgs = z.infer<z.ZodObject<typeof addRepoShape>>;

/** An issue as the contract answers it (camelCase; 64-bit integers as decimal strings). */
interface WireIssue {
  id: string;
  title: string;
  summary: string;
  impact: string;
  repro: string;
  resolutionCriteria: string;
  [key: string]: unknown;
}

interface IssueDetail {
  issue: WireIssue;
  comments: unknown[];
}

/** The contract's getRepoInfo view. */
interface RepoInfo {
  repoUrl: string;
}

// ── the tools' work, against a client and a resolved repo ───────────────────

export function createIssue(client: Client, target: ResolvedTarget, args: CreateIssueArgs) {
  return callMethod<string>(client, target, 'createIssue', {
    title: args.title,
    summary: args.summary,
    impact: args.impact,
    repro: args.repro,
    resolutionCriteria: args.resolution_criteria,
    priority: args.priority,
    labels: args.labels,
  });
}

export function listIssues(client: Client, target: ResolvedTarget, args: ListIssuesArgs) {
  return viewMethod(client, target, 'listIssues', {
    status: args.status ?? null,
    assignee: args.assignee ?? null,
    label: args.label ?? null,
  });
}

export function getIssue(client: Client, target: ResolvedTarget, args: GetIssueArgs) {
  return viewMethod<IssueDetail>(client, target, 'getIssue', { issueId: args.id });
}

export function addComment(client: Client, target: ResolvedTarget, args: AddCommentArgs) {
  return callMethod<string>(client, target, 'addComment', { issueId: args.issue_id, body: args.body });
}

export function assignIssue(client: Client, target: ResolvedTarget, args: AssignIssueArgs) {
  return callMethod(client, target, 'setAssignee', { issueId: args.issue_id, assignee: args.assignee });
}

export function setStatus(client: Client, target: ResolvedTarget, args: SetStatusArgs) {
  return callMethod(client, target, 'setStatus', { issueId: args.issue_id, status: args.status });
}

export function setPriority(client: Client, target: ResolvedTarget, args: SetPriorityArgs) {
  return callMethod(client, target, 'setPriority', { issueId: args.issue_id, priority: args.priority });
}

export function deleteIssue(client: Client, target: ResolvedTarget, args: DeleteIssueArgs) {
  return callMethod(client, target, 'deleteIssue', { issueId: args.issue_id });
}

export async function getFixPrompt(client: Client, target: ResolvedTarget, args: GetFixPromptArgs) {
  const [detail, repoInfo] = await Promise.all([
    viewMethod<IssueDetail>(client, target, 'getIssue', { issueId: args.id }),
    viewMethod<RepoInfo>(client, target, 'getRepoInfo', {}),
  ]);
  const i = detail.issue;
  return buildFixPrompt({
    id: i.id,
    title: i.title,
    summary: i.summary,
    impact: i.impact,
    repro: i.repro,
    resolution_criteria: i.resolutionCriteria,
    repo_url: repoInfo.repoUrl,
  });
}

/** Every repo of the workspace with its repo_url, read from each repo's own app. */
export async function listRepos(
  client: Client,
  repos: WorkspaceRepo[],
): Promise<Array<{ name: string; repo_url: string }>> {
  return Promise.all(
    repos.map(async (repo) => {
      const info = await viewMethod<RepoInfo>(client, { appId: repo.appId }, 'getRepoInfo', {});
      return { name: repo.name, repo_url: info.repoUrl };
    }),
  );
}

/** Onboards a new repo: an app instance in the workspace's org, with its repo_url set. Mirrors the app's addRepo. */
export async function addRepo(
  client: Client,
  cfg: Config,
  args: AddRepoArgs,
): Promise<{ appId: string; name: string; url: string }> {
  if (!cfg.workspaceRaw) {
    throw new Error('add_repo requires TRACKER_WORKSPACE (TRACKER_APP pins one repo, with no workspace to add to).');
  }
  const name = args.name.trim();
  const url = args.github_url.trim();
  const org = await findWorkspace(client, cfg);
  const existing = await listWorkspaceRepos(client, cfg, org.orgId);
  if (existing.some((r) => r.name === name)) {
    throw new Error(`Repo "${name}" already exists.`);
  }
  const target = typeof cfg.source === 'string' ? { bundle: cfg.source } : cfg.source;
  const { appId } = await client.apps.create({ name, ...target, org: org.orgId });
  await callMethod(client, { appId }, 'setRepoUrl', { url });
  return { appId, name, url };
}

// ---- MCP result helpers ----

function textResult(data: unknown) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text' as const, text }] };
}

function errorResult(err: unknown) {
  const message = describe(err);
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

// ---- Server wiring ----

export function createServer(cfg: Config = loadConfig(), getClient?: () => Promise<Client>): McpServer {
  const server = new McpServer({ name: 'issue-tracker-mcp', version: '0.1.0' });

  // One client per process, connected (and its node attested) on first use.
  let clientCached: Promise<Client> | null = null;
  const client =
    getClient ??
    (() =>
      (clientCached ??= connect(cfg).catch((err) => {
        clientCached = null;
        throw err;
      })));
  const listReposCache = createRepoLister(cfg, client);
  const target = createTargetResolver(cfg, listReposCache);

  server.registerTool(
    'create_issue',
    {
      description:
        'Create a new issue with a title and structured summary/impact/repro/resolution_criteria sections.',
      inputSchema: createIssueShape,
    },
    async (args) => {
      try {
        const id = await createIssue(await client(), await target(args.repo), args);
        return textResult({ id });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'list_issues',
    { description: 'List issues, optionally filtered by status, assignee, or label.', inputSchema: listIssuesShape },
    async (args) => {
      try {
        return textResult(await listIssues(await client(), await target(args.repo), args));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_issue',
    { description: 'Get an issue and its comments by id.', inputSchema: getIssueShape },
    async (args) => {
      try {
        return textResult(await getIssue(await client(), await target(args.repo), args));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'add_comment',
    { description: 'Add a comment to an issue.', inputSchema: addCommentShape },
    async (args) => {
      try {
        const id = await addComment(await client(), await target(args.repo), args);
        return textResult({ id });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'assign_issue',
    { description: 'Assign an issue to a member.', inputSchema: assignIssueShape },
    async (args) => {
      try {
        await assignIssue(await client(), await target(args.repo), args);
        return textResult({ ok: true });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'set_status',
    { description: 'Set an issue\'s status (Open, In progress, Blocked, or Done).', inputSchema: setStatusShape },
    async (args) => {
      try {
        await setStatus(await client(), await target(args.repo), args);
        return textResult({ ok: true });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'set_priority',
    { description: 'Set an issue\'s priority (low, medium, high, or urgent).', inputSchema: setPriorityShape },
    async (args) => {
      try {
        await setPriority(await client(), await target(args.repo), args);
        return textResult({ ok: true });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'delete_issue',
    {
      description:
        "Delete an issue. Only the issue's creator may delete it; removes its comments and labels.",
      inputSchema: deleteIssueShape,
    },
    async (args) => {
      try {
        await deleteIssue(await client(), await target(args.repo), args);
        return textResult({ deleted: args.issue_id });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_fix_prompt',
    {
      description: 'Build a fix prompt for an issue: title, summary, impact, repro, resolution criteria, and repository URL.',
      inputSchema: getFixPromptShape,
    },
    async (args) => {
      try {
        return textResult(await getFixPrompt(await client(), await target(args.repo), args));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'list_repos',
    { description: 'List the repos in the workspace, each with its name and repo_url.', inputSchema: listReposShape },
    async () => {
      try {
        return textResult(await listRepos(await client(), await listReposCache()));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'add_repo',
    {
      description:
        'Onboard a new repo: creates an instance of the tracker in TRACKER_WORKSPACE named after the repo, and sets its repo_url.',
      inputSchema: addRepoShape,
    },
    async (args) => {
      try {
        return textResult(await addRepo(await client(), cfg, args));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
