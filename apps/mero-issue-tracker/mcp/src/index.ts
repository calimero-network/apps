#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, type Config } from './config.ts';
import { callMethod, createTargetResolver, type ResolvedTarget } from './rpc.ts';
import { buildFixPrompt, type IssueForPrompt } from './fixPrompt.ts';

// ---- Tool input schemas ----

export const createIssueShape = {
  title: z.string().min(1, 'title is required'),
  summary: z.string().min(1, 'summary is required'),
  impact: z.string().min(1, 'impact is required'),
  repro: z.string().min(1, 'repro is required'),
  resolution_criteria: z.string().min(1, 'resolution_criteria is required'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  labels: z.array(z.string()).default([]),
};

export const listIssuesShape = {
  status: z.string().optional(),
  assignee: z.string().optional(),
  label: z.string().optional(),
};

export const getIssueShape = {
  id: z.string().min(1, 'id is required'),
};

export const addCommentShape = {
  issue_id: z.string().min(1, 'issue_id is required'),
  body: z.string().min(1, 'body is required'),
};

export const assignIssueShape = {
  issue_id: z.string().min(1, 'issue_id is required'),
  assignee: z.string().min(1, 'assignee is required'),
};

export const getFixPromptShape = {
  id: z.string().min(1, 'id is required'),
};

type CreateIssueArgs = z.infer<z.ZodObject<typeof createIssueShape>>;
type ListIssuesArgs = z.infer<z.ZodObject<typeof listIssuesShape>>;
type GetIssueArgs = z.infer<z.ZodObject<typeof getIssueShape>>;
type AddCommentArgs = z.infer<z.ZodObject<typeof addCommentShape>>;
type AssignIssueArgs = z.infer<z.ZodObject<typeof assignIssueShape>>;
type GetFixPromptArgs = z.infer<z.ZodObject<typeof getFixPromptShape>>;

interface IssueDetail {
  issue: IssueForPrompt & Record<string, unknown>;
  comments: unknown[];
}

// ---- Tool request shaping - pure functions, unit-tested against a mocked fetch ----

export function createIssue(cfg: Config, target: ResolvedTarget, args: CreateIssueArgs) {
  return callMethod<string>(cfg, target, 'create_issue', {
    title: args.title,
    summary: args.summary,
    impact: args.impact,
    repro: args.repro,
    resolution_criteria: args.resolution_criteria,
    priority: args.priority,
    labels: args.labels,
  });
}

export function listIssues(cfg: Config, target: ResolvedTarget, args: ListIssuesArgs) {
  return callMethod(cfg, target, 'list_issues', {
    status: args.status ?? null,
    assignee: args.assignee ?? null,
    label: args.label ?? null,
  });
}

export function getIssue(cfg: Config, target: ResolvedTarget, args: GetIssueArgs) {
  return callMethod<IssueDetail>(cfg, target, 'get_issue', { issue_id: args.id });
}

export function addComment(cfg: Config, target: ResolvedTarget, args: AddCommentArgs) {
  return callMethod<string>(cfg, target, 'add_comment', { issue_id: args.issue_id, body: args.body });
}

export function assignIssue(cfg: Config, target: ResolvedTarget, args: AssignIssueArgs) {
  return callMethod(cfg, target, 'set_assignee', { issue_id: args.issue_id, assignee: args.assignee });
}

export async function getFixPrompt(cfg: Config, target: ResolvedTarget, args: GetFixPromptArgs) {
  const detail = await callMethod<IssueDetail>(cfg, target, 'get_issue', { issue_id: args.id });
  return buildFixPrompt(detail.issue);
}

// ---- MCP result helpers ----

function textResult(data: unknown) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text' as const, text }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

// ---- Server wiring ----

export function createServer(cfg: Config = loadConfig()): McpServer {
  const server = new McpServer({ name: 'issue-tracker-mcp', version: '0.1.0' });

  // Resolved once and reused across every tool call in the process's lifetime.
  const target = createTargetResolver(cfg);

  server.registerTool(
    'create_issue',
    {
      description:
        'Create a new issue with a title and structured summary/impact/repro/resolution_criteria sections.',
      inputSchema: createIssueShape,
    },
    async (args) => {
      try {
        const id = await createIssue(cfg, await target(), args);
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
        return textResult(await listIssues(cfg, await target(), args));
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
        return textResult(await getIssue(cfg, await target(), args));
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
        const id = await addComment(cfg, await target(), args);
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
        await assignIssue(cfg, await target(), args);
        return textResult({ ok: true });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_fix_prompt',
    { description: 'Build a fix prompt for an issue (placeholder until task 7 authors the real template).', inputSchema: getFixPromptShape },
    async (args) => {
      try {
        return textResult(await getFixPrompt(cfg, await target(), args));
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
