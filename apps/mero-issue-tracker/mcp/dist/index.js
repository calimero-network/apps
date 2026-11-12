#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from "./config.js";
import { callMethod, connect, createRepoLister, createTargetResolver, describe, findWorkspace, listWorkspaceRepos, viewMethod, } from "./node.js";
import { buildFixPrompt } from "./fixPrompt.js";
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
// ── the tools' work, against a client and a resolved repo ───────────────────
export function createIssue(client, target, args) {
    return callMethod(client, target, 'createIssue', {
        title: args.title,
        summary: args.summary,
        impact: args.impact,
        repro: args.repro,
        resolutionCriteria: args.resolution_criteria,
        priority: args.priority,
        labels: args.labels,
    });
}
export function listIssues(client, target, args) {
    return viewMethod(client, target, 'listIssues', {
        status: args.status ?? null,
        assignee: args.assignee ?? null,
        label: args.label ?? null,
    });
}
export function getIssue(client, target, args) {
    return viewMethod(client, target, 'getIssue', { issueId: args.id });
}
export function addComment(client, target, args) {
    return callMethod(client, target, 'addComment', { issueId: args.issue_id, body: args.body });
}
export function assignIssue(client, target, args) {
    return callMethod(client, target, 'setAssignee', { issueId: args.issue_id, assignee: args.assignee });
}
export function setStatus(client, target, args) {
    return callMethod(client, target, 'setStatus', { issueId: args.issue_id, status: args.status });
}
export function setPriority(client, target, args) {
    return callMethod(client, target, 'setPriority', { issueId: args.issue_id, priority: args.priority });
}
export function deleteIssue(client, target, args) {
    return callMethod(client, target, 'deleteIssue', { issueId: args.issue_id });
}
export async function getFixPrompt(client, target, args) {
    const [detail, repoInfo] = await Promise.all([
        viewMethod(client, target, 'getIssue', { issueId: args.id }),
        viewMethod(client, target, 'getRepoInfo', {}),
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
export async function listRepos(client, repos) {
    return Promise.all(repos.map(async (repo) => {
        const info = await viewMethod(client, { appId: repo.appId }, 'getRepoInfo', {});
        return { name: repo.name, repo_url: info.repoUrl };
    }));
}
/** Onboards a new repo: an app instance in the workspace's org, with its repo_url set. Mirrors the app's addRepo. */
export async function addRepo(client, cfg, args) {
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
function textResult(data) {
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return { content: [{ type: 'text', text }] };
}
function errorResult(err) {
    const message = describe(err);
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}
// ---- Server wiring ----
export function createServer(cfg = loadConfig(), getClient) {
    const server = new McpServer({ name: 'issue-tracker-mcp', version: '0.1.0' });
    // One client per process, connected (and its node attested) on first use.
    let clientCached = null;
    const client = getClient ??
        (() => (clientCached ??= connect(cfg).catch((err) => {
            clientCached = null;
            throw err;
        })));
    const listReposCache = createRepoLister(cfg, client);
    const target = createTargetResolver(cfg, listReposCache);
    server.registerTool('create_issue', {
        description: 'Create a new issue with a title and structured summary/impact/repro/resolution_criteria sections.',
        inputSchema: createIssueShape,
    }, async (args) => {
        try {
            const id = await createIssue(await client(), await target(args.repo), args);
            return textResult({ id });
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool('list_issues', { description: 'List issues, optionally filtered by status, assignee, or label.', inputSchema: listIssuesShape }, async (args) => {
        try {
            return textResult(await listIssues(await client(), await target(args.repo), args));
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool('get_issue', { description: 'Get an issue and its comments by id.', inputSchema: getIssueShape }, async (args) => {
        try {
            return textResult(await getIssue(await client(), await target(args.repo), args));
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool('add_comment', { description: 'Add a comment to an issue.', inputSchema: addCommentShape }, async (args) => {
        try {
            const id = await addComment(await client(), await target(args.repo), args);
            return textResult({ id });
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool('assign_issue', { description: 'Assign an issue to a member.', inputSchema: assignIssueShape }, async (args) => {
        try {
            await assignIssue(await client(), await target(args.repo), args);
            return textResult({ ok: true });
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool('set_status', { description: 'Set an issue\'s status (Open, In progress, Blocked, or Done).', inputSchema: setStatusShape }, async (args) => {
        try {
            await setStatus(await client(), await target(args.repo), args);
            return textResult({ ok: true });
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool('set_priority', { description: 'Set an issue\'s priority (low, medium, high, or urgent).', inputSchema: setPriorityShape }, async (args) => {
        try {
            await setPriority(await client(), await target(args.repo), args);
            return textResult({ ok: true });
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool('delete_issue', {
        description: "Delete an issue. Only the issue's creator may delete it; removes its comments and labels.",
        inputSchema: deleteIssueShape,
    }, async (args) => {
        try {
            await deleteIssue(await client(), await target(args.repo), args);
            return textResult({ deleted: args.issue_id });
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool('get_fix_prompt', {
        description: 'Build a fix prompt for an issue: title, summary, impact, repro, resolution criteria, and repository URL.',
        inputSchema: getFixPromptShape,
    }, async (args) => {
        try {
            return textResult(await getFixPrompt(await client(), await target(args.repo), args));
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool('list_repos', { description: 'List the repos in the workspace, each with its name and repo_url.', inputSchema: listReposShape }, async () => {
        try {
            return textResult(await listRepos(await client(), await listReposCache()));
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool('add_repo', {
        description: 'Onboard a new repo: creates an instance of the tracker in TRACKER_WORKSPACE named after the repo, and sets its repo_url.',
        inputSchema: addRepoShape,
    }, async (args) => {
        try {
            return textResult(await addRepo(await client(), cfg, args));
        }
        catch (err) {
            return errorResult(err);
        }
    });
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
