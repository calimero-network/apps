#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, type Config } from './config.ts';
import {
  callMethod,
  createContext,
  createContextAlias,
  createFolderLister,
  createTargetResolver,
  listNamespaceFolders,
  resolveNamespaceApp,
  type NamespaceFolder,
  type ResolvedTarget,
} from './rpc.ts';
import { resolveRank, positionSchemaDescription, type Position, type Ranked } from './position.ts';

// A folder (context alias) to target within the namespace; defaults to
// BOARD_FOLDER, else the namespace's only folder.
const folderParam = z
  .string()
  .optional()
  .describe("Folder (context alias) to target; defaults to BOARD_FOLDER or the namespace's only folder.");

const POSITION_RE = /^(top|bottom|after:.+)$/;
const POSITION_MSG = "position must be 'top', 'bottom' or 'after:<id>'";

// ---- Tool input schemas ----

export const shapes = {
  listFolders: {},
  addFolder: { name: z.string().min(1, 'name is required') },
  listBoards: { include_archived: z.boolean().default(false), folder: folderParam },
  createBoard: { name: z.string().min(1).max(64), folder: folderParam },
  renameBoard: { board_id: z.string().min(1), name: z.string().min(1).max(64), folder: folderParam },
  archiveBoard: { board_id: z.string().min(1), archived: z.boolean(), folder: folderParam },
  deleteBoard: { board_id: z.string().min(1), folder: folderParam },
  getBoard: { board_id: z.string().min(1), folder: folderParam },
  createList: { board_id: z.string().min(1), name: z.string().min(1).max(64), folder: folderParam },
  renameList: { list_id: z.string().min(1), name: z.string().min(1).max(64), folder: folderParam },
  moveList: {
    list_id: z.string().min(1),
    position: z
      .string()
      .regex(POSITION_RE, POSITION_MSG)
      .describe("Where to place it: 'top', 'bottom', or 'after:<list id>' (another list on the same board)."),
    folder: folderParam,
  },
  deleteList: { list_id: z.string().min(1), folder: folderParam },
  createCard: {
    board_id: z.string().min(1),
    list_id: z.string().min(1),
    title: z.string().min(1).max(64),
    description: z.string().optional(),
    assignee: z.string().optional().describe('Account id (or any text) of the assignee.'),
    due_at: z.number().int().nonnegative().optional().describe('Due date, unix milliseconds.'),
    labels: z.array(z.string().min(1).max(32)).default([]),
    folder: folderParam,
  },
  listCards: {
    board_id: z.string().optional(),
    list_id: z.string().optional(),
    assignee: z.string().optional(),
    label: z.string().optional(),
    include_archived: z.boolean().default(false),
    folder: folderParam,
  },
  getCard: { card_id: z.string().min(1), folder: folderParam },
  moveCard: {
    card_id: z.string().min(1),
    list_id: z.string().min(1).describe('Target list; must be on the same board as the card.'),
    position: z.string().regex(POSITION_RE, POSITION_MSG).describe(positionSchemaDescription),
    folder: folderParam,
  },
  setCard: {
    card_id: z.string().min(1),
    title: z.string().min(1).max(64).optional(),
    description: z.string().optional(),
    assignee: z.string().nullable().optional().describe('New assignee; null clears, omit to leave unchanged.'),
    due_at: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .describe('New due date in unix milliseconds; null clears, omit to leave unchanged.'),
    archived: z.boolean().optional(),
    folder: folderParam,
  },
  addLabel: { card_id: z.string().min(1), label: z.string().min(1).max(32), folder: folderParam },
  removeLabel: { card_id: z.string().min(1), label: z.string().min(1), folder: folderParam },
  addChecklistItem: { card_id: z.string().min(1), text: z.string().min(1), folder: folderParam },
  setChecklistItemDone: { item_id: z.string().min(1), done: z.boolean(), folder: folderParam },
  addComment: { card_id: z.string().min(1), body: z.string().min(1), folder: folderParam },
  deleteCard: { card_id: z.string().min(1), folder: folderParam },
};

type Args<K extends keyof typeof shapes> = z.infer<z.ZodObject<(typeof shapes)[K]>>;

interface BoardDetail {
  board: { id: string };
  lists: Array<{ id: string; rank: string }>;
  cards: Ranked[];
}
interface CardDetail {
  card: Ranked & { board_id: string };
}

// ---- Tool request shaping - unit-tested against a mocked fetch ----

export function createCard(cfg: Config, target: ResolvedTarget, args: Args<'createCard'>) {
  return callMethod<string>(cfg, target, 'create_card', {
    board_id: args.board_id,
    list_id: args.list_id,
    title: args.title,
    description: args.description ?? null,
    assignee: args.assignee ?? null,
    due_at: args.due_at ?? null,
    labels: args.labels,
    rank: null,
  });
}

export function listCards(cfg: Config, target: ResolvedTarget, args: Args<'listCards'>) {
  return callMethod(cfg, target, 'list_cards', {
    board_id: args.board_id ?? null,
    list_id: args.list_id ?? null,
    assignee: args.assignee ?? null,
    label: args.label ?? null,
    include_archived: args.include_archived,
  });
}

function getBoardDetail(cfg: Config, target: ResolvedTarget, boardId: string): Promise<BoardDetail> {
  return callMethod<BoardDetail>(cfg, target, 'get_board', { board_id: boardId });
}

/** Moves a card to `list_id` at `position`, computing the rank from the board's current cards. */
export async function moveCard(cfg: Config, target: ResolvedTarget, args: Pick<Args<'moveCard'>, 'card_id' | 'list_id' | 'position'>) {
  const { card } = await callMethod<CardDetail>(cfg, target, 'get_card', { card_id: args.card_id });
  const board = await getBoardDetail(cfg, target, card.board_id);
  if (!board.lists.some((l) => l.id === args.list_id)) {
    throw new Error(`list ${args.list_id} is not on the card's board ${card.board_id}`);
  }
  const rank = resolveRank(board.cards, args.list_id, args.position as Position, args.card_id);
  await callMethod(cfg, target, 'move_card', { card_id: args.card_id, list_id: args.list_id, rank });
  return { card_id: args.card_id, list_id: args.list_id, rank };
}

/** The board a list belongs to: scans every board in the folder (fine at folder scale). */
async function boardOfList(cfg: Config, target: ResolvedTarget, listId: string): Promise<BoardDetail> {
  const boards = await callMethod<Array<{ id: string }>>(cfg, target, 'list_boards', { include_archived: true });
  for (const b of boards) {
    const detail = await getBoardDetail(cfg, target, b.id);
    if (detail.lists.some((l) => l.id === listId)) return detail;
  }
  throw new Error(`list ${listId} not found in this folder`);
}

/** Moves a list among its board's lists at `position`. */
export async function moveList(cfg: Config, target: ResolvedTarget, args: Pick<Args<'moveList'>, 'list_id' | 'position'>) {
  const { lists } = await boardOfList(cfg, target, args.list_id);
  if (args.position.startsWith('after:')) {
    const afterId = args.position.slice('after:'.length);
    if (afterId === args.list_id || !lists.some((l) => l.id === afterId)) {
      throw new Error(`list ${afterId} is not another list on the same board`);
    }
  }
  const asRanked: Ranked[] = lists.map((l) => ({ id: l.id, list_id: 'board', rank: l.rank }));
  const rank = resolveRank(asRanked, 'board', args.position as Position, args.list_id);
  await callMethod(cfg, target, 'move_list', { list_id: args.list_id, rank });
  return { list_id: args.list_id, rank };
}

/** Applies each provided field with its own setter; `null` clears assignee/due_at, omission leaves them. */
export async function setCard(cfg: Config, target: ResolvedTarget, args: Omit<Args<'setCard'>, 'folder'>) {
  const id = args.card_id;
  if (args.title !== undefined) await callMethod(cfg, target, 'set_card_title', { card_id: id, title: args.title });
  if (args.description !== undefined) {
    await callMethod(cfg, target, 'set_card_description', { card_id: id, description: args.description });
  }
  if (args.assignee !== undefined) {
    await callMethod(cfg, target, 'set_card_assignee', { card_id: id, assignee: args.assignee });
  }
  if (args.due_at !== undefined) await callMethod(cfg, target, 'set_card_due', { card_id: id, due_at: args.due_at });
  if (args.archived !== undefined) {
    await callMethod(cfg, target, 'set_card_archived', { card_id: id, archived: args.archived });
  }
  return callMethod(cfg, target, 'get_card', { card_id: id });
}

/** Lists the folders (aliased contexts) in the namespace. */
export function listFolders(folders: NamespaceFolder[]): Array<{ name: string; context_id: string }> {
  return folders.map((f) => ({ name: f.name, context_id: f.contextId }));
}

/** Adds a folder: creates a `board` context in the namespace and aliases it by name. */
export async function addFolder(cfg: Config, args: Args<'addFolder'>): Promise<{ contextId: string; name: string }> {
  if (!cfg.namespaceRaw) {
    throw new Error(
      'add_folder requires BOARD_NAMESPACE (BOARD_CONTEXT pins a single context directly with no namespace to create a folder in).',
    );
  }
  const name = args.name.trim();
  const { namespaceId, applicationId } = await resolveNamespaceApp(cfg);
  const existing = await listNamespaceFolders(cfg, namespaceId);
  if (existing.some((f) => f.name === name)) {
    throw new Error(`Folder "${name}" already exists.`);
  }

  const { contextId } = await createContext(cfg, {
    applicationId,
    groupId: namespaceId,
    serviceName: cfg.serviceName,
    name,
  });

  try {
    await createContextAlias(cfg, name, contextId);
  } catch (err) {
    // stderr only - stdout is reserved for the MCP protocol stream.
    console.error(
      `[board-mcp] alias creation for "${name}" failed (${err instanceof Error ? err.message : String(err)}); folder created without an alias.`,
    );
  }

  return { contextId, name };
}

// ---- MCP result helpers ----

function textResult(data: unknown) {
  const text = typeof data === 'string' ? data : JSON.stringify(data ?? { ok: true }, null, 2);
  return { content: [{ type: 'text' as const, text }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

/** Drops the MCP-only `folder` param so the rest can be sent to the contract as-is. */
function contractArgs<T extends { folder?: string }>(args: T): Omit<T, 'folder'> {
  const { folder: _folder, ...rest } = args;
  return rest;
}

// ---- Server wiring ----

export function createServer(cfg: Config = loadConfig()): McpServer {
  const server = new McpServer({ name: 'board-mcp', version: '0.1.0' });

  // Resolved per folder and reused across every tool call in the process's lifetime.
  // One folder cache, shared by the resolver and list_folders, so add_folder
  // can invalidate both at once.
  const listFoldersCache = createFolderLister(cfg);
  const target = createTargetResolver(cfg, listFoldersCache);

  /** Registers a tool whose handler result is returned as JSON text, errors as an MCP error result. */
  function tool<K extends keyof typeof shapes>(
    name: string,
    description: string,
    key: K,
    run: (args: Args<K>) => Promise<unknown>,
  ) {
    // K is generic here, so the SDK cannot infer the handler args from shapes[key]; the
    // SDK still validates against that shape at runtime before calling us.
    const inputSchema: z.ZodRawShape = shapes[key];
    server.registerTool(name, { description, inputSchema }, async (args: Record<string, unknown>) => {
      try {
        return textResult(await run(args as Args<K>));
      } catch (err) {
        return errorResult(err);
      }
    });
  }

  /** A tool that forwards its args (minus `folder`) to one contract method. */
  function passThrough<K extends keyof typeof shapes>(
    name: string,
    description: string,
    key: K,
    method: string,
    wrap?: (out: unknown, args: Args<K>) => unknown,
  ) {
    tool(name, description, key, async (args) => {
      const a = args as Args<K> & { folder?: string };
      const out = await callMethod(cfg, await target(a.folder), method, contractArgs(a) as Record<string, unknown>);
      return wrap ? wrap(out, args) : out;
    });
  }

  const ok = () => ({ ok: true });
  const asId = (out: unknown) => ({ id: out });

  // Folders
  tool('list_folders', 'List the folders (aliased contexts) in BOARD_NAMESPACE, each with its name and context id.', 'listFolders', async () =>
    listFolders(await listFoldersCache()),
  );
  tool(
    'add_folder',
    'Create a folder: a new board context in BOARD_NAMESPACE, aliased by name. Returns its context id. Requires BOARD_NAMESPACE.',
    'addFolder',
    async (args) => {
      const created = await addFolder(cfg, args);
      // The new folder must show in list_folders and resolve as folder=<name> now.
      target.invalidate();
      return created;
    },
  );

  // Boards
  passThrough('list_boards', "List the folder's boards by rank; archived ones only with include_archived.", 'listBoards', 'list_boards');
  tool('create_board', 'Create a board (appended last) and return its id. Add columns with create_list.', 'createBoard', async (args) =>
    asId(await callMethod(cfg, await target(args.folder), 'create_board', { name: args.name, rank: null })),
  );
  passThrough('rename_board', 'Rename a board.', 'renameBoard', 'rename_board', ok);
  passThrough('archive_board', 'Archive (archived: true) or restore (false) a board.', 'archiveBoard', 'set_board_archived', ok);
  passThrough(
    'delete_board',
    "Delete a board with its lists, every card's shared data, and the caller's own comments; other members' cards and comments become unreachable. Creator only.",
    'deleteBoard',
    'delete_board',
    ok,
  );
  passThrough(
    'get_board',
    'Get a board with its lists and every card, both by rank. Archived cards are included with archived: true; skip them for the board view. Group cards by list_id for columns.',
    'getBoard',
    'get_board',
  );

  // Lists
  tool('create_list', 'Add a list (column) at the end of a board and return its id.', 'createList', async (args) =>
    asId(await callMethod(cfg, await target(args.folder), 'create_list', { board_id: args.board_id, name: args.name, rank: null })),
  );
  passThrough('rename_list', 'Rename a list.', 'renameList', 'rename_list', ok);
  tool('move_list', "Reorder a list on its board: 'top', 'bottom', or 'after:<list id>'.", 'moveList', async (args) =>
    moveList(cfg, await target(args.folder), args),
  );
  passThrough('delete_list', 'Delete a list. Fails while it holds unarchived cards: move or archive them first.', 'deleteList', 'delete_list', ok);

  // Cards
  tool(
    'create_card',
    'Create a card at the bottom of a list (the list must be on board_id) and return its id. due_at is unix milliseconds.',
    'createCard',
    async (args) => asId(await createCard(cfg, await target(args.folder), args)),
  );
  tool(
    'list_cards',
    'Find cards by exact board_id, list_id, assignee and label (all optional); sorted by board then rank.',
    'listCards',
    async (args) => listCards(cfg, await target(args.folder), args),
  );
  passThrough('get_card', 'Get a card with its checklist and comments.', 'getCard', 'get_card');
  tool(
    'move_card',
    "Move a card to a list on the same board at 'top', 'bottom', or 'after:<card id>'. A card stays on its board; moving across boards is not supported.",
    'moveCard',
    async (args) => moveCard(cfg, await target(args.folder), args),
  );
  tool(
    'set_card',
    'Edit a card: set any of title, description, assignee, due_at, archived. Omitted fields are left unchanged; null clears assignee or due_at. Returns the updated card.',
    'setCard',
    async (args) => setCard(cfg, await target(args.folder), contractArgs(args)),
  );
  passThrough('add_label', 'Add a label to a card (adding twice keeps one).', 'addLabel', 'add_label', ok);
  passThrough('remove_label', 'Remove a label from a card (removing a missing label succeeds).', 'removeLabel', 'remove_label', ok);
  tool('add_checklist_item', "Append a checklist item to a card and return the item's id.", 'addChecklistItem', async (args) =>
    asId(await callMethod(cfg, await target(args.folder), 'add_checklist_item', { card_id: args.card_id, text: args.text, rank: null })),
  );
  passThrough('set_checklist_item_done', 'Tick (done: true) or untick a checklist item.', 'setChecklistItemDone', 'set_checklist_item_done', ok);
  passThrough('add_comment', "Comment on a card and return the comment's id.", 'addComment', 'add_comment', asId);
  passThrough('delete_card', "Delete a card (creator only); takes the caller's comments with it. Prefer set_card archived: true to hide.", 'deleteCard', 'delete_card', ok);

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
