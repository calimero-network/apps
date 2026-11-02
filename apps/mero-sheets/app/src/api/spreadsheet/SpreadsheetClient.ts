/**
 * The contract, typed: one method per contract method, with v1's names and
 * argument shapes, so the hooks and screens did not change when the app moved
 * to Calimero 1.0. Replaces the client abi-codegen generated from the v1 ABI.
 *
 * What it does on the way:
 *  - calls `client.call` (a write, logged) or `client.view` (a read) on the app
 *    instance, with the contract's camelCase method and argument names;
 *  - sends 64-bit integers (`size`, `since`) as the decimal strings the
 *    contract takes, and turns the ones in answers (`created_at`, `at`, ...)
 *    back into numbers, as v1 answered them;
 *  - reads paged views (`{ items, next }`) one page at a time, following
 *    `next` to the end, so the screens still get the whole list v1 answered.
 *
 * Linked ranges need nothing here: the contract pushes them to the other
 * workbook itself, with a cross-app call (`env::xcall`), as v1 did.
 */
import type { CalimeroClient } from '@calimero-network/mero-js';
import type {
  ActivityEntry, Attachment, AxisOp, AxisSize, Cell, CellOp, CellStyle, Chart, ChartInput, Comment,
  FunctionDef, Link, Member, NamedRange, NoteChange, NotedCell, Project, Protection, Publication, Rule,
  RuleInput, Sheet, SheetLayout, SheetView, Span, StyleOp,
} from './types';

export * from './types';

/** One page of a paged view. */
export interface Page<T> {
  items: T[];
  /** The cursor of the next page; null after the last one. */
  next: string | null;
}

/** What the adapter needs of a `CalimeroClient`. */
export type ContractTransport = Pick<CalimeroClient, 'call' | 'view'>;

/**
 * Every contract method this client calls and its parameter names, in the
 * contract's spelling. `abi.test.ts` holds it against the committed
 * `logic/res/abi.json`.
 */
export const CONTRACT_METHODS: Record<string, string[]> = {
  addAttachment: ['sheetId', 'rowId', 'colId', 'blobId', 'name', 'size', 'mime'],
  addChart: ['chart'],
  addComment: ['sheetId', 'rowId', 'colId', 'text', 'parent'],
  addRule: ['rule'],
  applyAxisOps: ['sheetId', 'ops'],
  applyCellOps: ['sheetId', 'ops'],
  applyPrivateCellOps: ['sheetId', 'ops'],
  applyStyleOps: ['sheetId', 'ops'],
  clearCell: ['sheetId', 'rowId', 'colId'],
  createPrivateSheet: ['name'],
  createSheet: ['name'],
  deleteComment: ['id'],
  deleteNamedRange: ['name'],
  deletePrivateSheet: ['sheetId'],
  deleteSheet: ['sheetId'],
  editComment: ['id', 'text'],
  editNote: ['sheetId', 'rowId', 'colId', 'ops'],
  exportAll: [],
  getActivity: ['since', 'limit'],
  getAllCells: ['cursor', 'limit'],
  getAttachments: ['cursor', 'limit'],
  getCells: ['sheetId', 'cursor', 'limit'],
  getCharts: [],
  getComments: ['cursor', 'limit'],
  getFunctions: [],
  grantAttachment: ['id'],
  getLayouts: [],
  getLinks: [],
  getMembers: ['cursor', 'limit'],
  getNamedRanges: [],
  getNote: ['sheetId', 'rowId', 'colId'],
  getNotedCells: ['cursor', 'limit'],
  getPrivateCells: ['cursor', 'limit'],
  getPrivateSheets: [],
  getProject: [],
  getProtections: [],
  getPublications: [],
  getRules: [],
  getSheetViews: [],
  getStyles: ['cursor', 'limit'],
  initProject: ['name'],
  join: ['nickname'],
  listSheets: [],
  protectRange: ['sheetId', 'topRowId', 'leftColId', 'bottomRowId', 'rightColId', 'description', 'editors'],
  publishRange: ['sheetId', 'topRowId', 'leftColId', 'bottomRowId', 'rightColId', 'targetContext', 'name'],
  pushPublication: ['id'],
  removeAttachment: ['id'],
  removeChart: ['id'],
  removeProtection: ['id'],
  removeRule: ['id'],
  renamePrivateSheet: ['sheetId', 'name'],
  renameSheet: ['sheetId', 'newName'],
  searchFunctions: ['prefix'],
  setCell: ['sheetId', 'rowId', 'colId', 'rawValue'],
  setCellFormat: ['sheetId', 'rowId', 'colId', 'format'],
  setCommentResolved: ['id', 'resolved'],
  setFrozen: ['sheetId', 'rows', 'cols'],
  setNamedRange: ['name', 'target'],
  setRole: ['memberId', 'role'],
  setSizes: ['sheetId', 'sizes'],
  unlink: ['id'],
  unpublish: ['id'],
  updateChart: ['id', 'chart'],
  updateProtection: ['id', 'description', 'editors'],
  updateRule: ['id', 'rule'],
  whoami: [],
};

/**
 * Contract methods only another workbook calls, through the platform's xcall
 * delivery (`allow(app = "*")`): the contract refuses every account. This
 * client never calls them.
 */
export const APP_ONLY_METHODS: ReadonlySet<string> = new Set(['dropLink', 'receiveLink']);

/** The contract methods that are views (reads); every other one is a call. */
export const CONTRACT_VIEWS: ReadonlySet<string> = new Set([
  'exportAll',
  'getActivity',
  'getAllCells',
  'getAttachments',
  'getCells',
  'getCharts',
  'getComments',
  'getFunctions',
  'grantAttachment',
  'getLayouts',
  'getLinks',
  'getMembers',
  'getNamedRanges',
  'getNote',
  'getNotedCells',
  'getPrivateCells',
  'getPrivateSheets',
  'getProject',
  'getProtections',
  'getPublications',
  'getRules',
  'getSheetViews',
  'getStyles',
  'listSheets',
  'searchFunctions',
  'whoami',
]);

/** Answer fields that are 64-bit integers: decimal strings on the wire. */
const U64_FIELDS = new Set(['created_at', 'updated_at', 'joined_at', 'at', 'last_edited_at', 'size']);

/** A 64-bit integer argument as the decimal string the contract takes. */
export function u64(n: number): string {
  return BigInt(Math.max(0, Math.trunc(n))).toString();
}

/** An answer with its 64-bit integer fields back as numbers, as v1 answered. */
export function fromWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromWire);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = U64_FIELDS.has(k) && typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : fromWire(v);
    }
    return out;
  }
  return value;
}

/** The page size the adapter asks for: the most a contract view answers. */
const PAGE_LIMIT = 1000;

export class SpreadsheetClient {
  /**
   * @param client the signed-in `CalimeroClient` (or anything with its `call` and `view`)
   * @param appId the workbook: an app instance id
   * @param after run after every request (keeps the stored session current)
   */
  constructor(
    private readonly client: ContractTransport,
    readonly appId: string,
    private readonly after: () => void = () => {},
  ) {}

  private async call<T>(method: string, args: Record<string, unknown>): Promise<T> {
    try {
      const { result } = await this.client.call(this.appId, method, args);
      return fromWire(result) as T;
    } finally {
      this.after();
    }
  }

  private async view<T>(method: string, args: Record<string, unknown>): Promise<T> {
    try {
      const { result } = await this.client.view(this.appId, method, args);
      return fromWire(result) as T;
    } finally {
      this.after();
    }
  }

  /** Every page of a paged view, followed through `next`, as one list. */
  private async pages<T>(method: string, args: Record<string, unknown> = {}): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | null = null;
    do {
      const page: Page<T> = await this.view<Page<T>>(method, { ...args, limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) });
      out.push(...page.items);
      cursor = page.next;
    } while (cursor);
    return out;
  }

  // ── linked ranges: the contract pushes them (xcall) ────────────────────────

  async getPublications(): Promise<Publication[]> {
    return this.view<Publication[]>('getPublications', {});
  }

  /** Link a range to another workbook; the contract sends it its first values. */
  async publishRange(params: { sheet_id: string; top_row_id: string; left_col_id: string; bottom_row_id: string; right_col_id: string; target_context: string; name: string }): Promise<string> {
    return this.call<string>('publishRange', { sheetId: params.sheet_id, topRowId: params.top_row_id, leftColId: params.left_col_id, bottomRowId: params.bottom_row_id, rightColId: params.right_col_id, targetContext: params.target_context, name: params.name });
  }

  /** Push a link's values again now. */
  async pushPublication(params: { id: string }): Promise<void> {
    return this.call<void>('pushPublication', { id: params.id });
  }

  /** Stop a link; the contract takes its sheet out of the other workbook. */
  async unpublish(params: { id: string }): Promise<void> {
    return this.call<void>('unpublish', { id: params.id });
  }

  /** A download link (`?grant=`) for an attachment's blob, valid for an hour. */
  async grantAttachment(params: { id: string }): Promise<string> {
    return this.view<string>('grantAttachment', { id: params.id });
  }

  // ── every other method, one to one ─────────────────────────────────────────

  async addAttachment(params: { sheet_id: string; row_id: string; col_id: string; blob_id: string; name: string; size: number; mime: string }): Promise<string> {
    return this.call<string>('addAttachment', { sheetId: params.sheet_id, rowId: params.row_id, colId: params.col_id, blobId: params.blob_id, name: params.name, size: u64(params.size), mime: params.mime });
  }

  async addChart(params: { chart: ChartInput }): Promise<string> {
    return this.call<string>('addChart', { chart: params.chart });
  }

  async addComment(params: { sheet_id: string; row_id: string; col_id: string; text: string; parent: string }): Promise<string> {
    return this.call<string>('addComment', { sheetId: params.sheet_id, rowId: params.row_id, colId: params.col_id, text: params.text, parent: params.parent });
  }

  async addRule(params: { rule: RuleInput }): Promise<string> {
    return this.call<string>('addRule', { rule: params.rule });
  }

  async applyAxisOps(params: { sheet_id: string; ops: AxisOp[] }): Promise<void> {
    return this.call<void>('applyAxisOps', { sheetId: params.sheet_id, ops: params.ops });
  }

  async applyCellOps(params: { sheet_id: string; ops: CellOp[] }): Promise<void> {
    return this.call<void>('applyCellOps', { sheetId: params.sheet_id, ops: params.ops });
  }

  async applyPrivateCellOps(params: { sheet_id: string; ops: CellOp[] }): Promise<void> {
    return this.call<void>('applyPrivateCellOps', { sheetId: params.sheet_id, ops: params.ops });
  }

  async applyStyleOps(params: { sheet_id: string; ops: StyleOp[] }): Promise<void> {
    return this.call<void>('applyStyleOps', { sheetId: params.sheet_id, ops: params.ops });
  }

  async clearCell(params: { sheet_id: string; row_id: string; col_id: string }): Promise<void> {
    return this.call<void>('clearCell', { sheetId: params.sheet_id, rowId: params.row_id, colId: params.col_id });
  }

  async createPrivateSheet(params: { name: string }): Promise<string> {
    return this.call<string>('createPrivateSheet', { name: params.name });
  }

  async createSheet(params: { name: string }): Promise<string> {
    return this.call<string>('createSheet', { name: params.name });
  }

  async deleteComment(params: { id: string }): Promise<void> {
    return this.call<void>('deleteComment', { id: params.id });
  }

  async deleteNamedRange(params: { name: string }): Promise<void> {
    return this.call<void>('deleteNamedRange', { name: params.name });
  }

  async deletePrivateSheet(params: { sheet_id: string }): Promise<void> {
    return this.call<void>('deletePrivateSheet', { sheetId: params.sheet_id });
  }

  async deleteSheet(params: { sheet_id: string }): Promise<void> {
    return this.call<void>('deleteSheet', { sheetId: params.sheet_id });
  }

  async editComment(params: { id: string; text: string }): Promise<void> {
    return this.call<void>('editComment', { id: params.id, text: params.text });
  }

  async editNote(params: { sheet_id: string; row_id: string; col_id: string; ops: NoteChange[] }): Promise<void> {
    return this.call<void>('editNote', { sheetId: params.sheet_id, rowId: params.row_id, colId: params.col_id, ops: params.ops });
  }

  async exportAll(): Promise<Sheet[]> {
    return this.view<Sheet[]>('exportAll', {});
  }

  async getActivity(params: { since: number; limit: number }): Promise<ActivityEntry[]> {
    return this.view<ActivityEntry[]>('getActivity', { since: u64(params.since), limit: params.limit });
  }

  /** Every cell of every sheet: the stored ones page by page, then each linked sheet's. */
  async getAllCells(): Promise<Cell[]> {
    const stored = await this.pages<Cell>('getAllCells');
    const linked = (await this.listSheets()).filter((sh) => sh.linked_from !== '');
    const pushed = await Promise.all(linked.map((sh) => this.getCells({ sheet_id: sh.id })));
    return [...stored, ...pushed.flat()];
  }

  async getAttachments(): Promise<Attachment[]> {
    return this.pages<Attachment>('getAttachments');
  }

  async getCells(params: { sheet_id: string }): Promise<Cell[]> {
    return this.pages<Cell>('getCells', { sheetId: params.sheet_id });
  }

  async getCharts(): Promise<Chart[]> {
    return this.view<Chart[]>('getCharts', {});
  }

  async getComments(): Promise<Comment[]> {
    return this.pages<Comment>('getComments');
  }

  async getFunctions(): Promise<FunctionDef[]> {
    return this.view<FunctionDef[]>('getFunctions', {});
  }

  async getLayouts(): Promise<SheetLayout[]> {
    return this.view<SheetLayout[]>('getLayouts', {});
  }

  async getLinks(): Promise<Link[]> {
    return this.view<Link[]>('getLinks', {});
  }

  /** Everyone who announced themselves, oldest arrival first (the contract pages by account). */
  async getMembers(): Promise<Member[]> {
    const members = await this.pages<Member>('getMembers');
    return members.sort((a, b) => a.joined_at - b.joined_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  async getNamedRanges(): Promise<NamedRange[]> {
    return this.view<NamedRange[]>('getNamedRanges', {});
  }

  async getNote(params: { sheet_id: string; row_id: string; col_id: string }): Promise<Span[]> {
    return this.view<Span[]>('getNote', { sheetId: params.sheet_id, rowId: params.row_id, colId: params.col_id });
  }

  async getNotedCells(): Promise<NotedCell[]> {
    return this.pages<NotedCell>('getNotedCells');
  }

  async getPrivateCells(): Promise<Cell[]> {
    return this.pages<Cell>('getPrivateCells');
  }

  async getPrivateSheets(): Promise<Sheet[]> {
    return this.view<Sheet[]>('getPrivateSheets', {});
  }

  async getProject(): Promise<Project> {
    return this.view<Project>('getProject', {});
  }

  async getProtections(): Promise<Protection[]> {
    return this.view<Protection[]>('getProtections', {});
  }

  async getRules(): Promise<Rule[]> {
    return this.view<Rule[]>('getRules', {});
  }

  async getSheetViews(): Promise<SheetView[]> {
    return this.view<SheetView[]>('getSheetViews', {});
  }

  async getStyles(): Promise<CellStyle[]> {
    return this.pages<CellStyle>('getStyles');
  }

  async initProject(params: { name: string }): Promise<string> {
    return this.call<string>('initProject', { name: params.name });
  }

  async join(params: { nickname: string }): Promise<void> {
    return this.call<void>('join', { nickname: params.nickname });
  }

  async listSheets(): Promise<Sheet[]> {
    return this.view<Sheet[]>('listSheets', {});
  }

  async protectRange(params: { sheet_id: string; top_row_id: string; left_col_id: string; bottom_row_id: string; right_col_id: string; description: string; editors: string[] }): Promise<string> {
    return this.call<string>('protectRange', { sheetId: params.sheet_id, topRowId: params.top_row_id, leftColId: params.left_col_id, bottomRowId: params.bottom_row_id, rightColId: params.right_col_id, description: params.description, editors: params.editors });
  }

  async removeAttachment(params: { id: string }): Promise<void> {
    return this.call<void>('removeAttachment', { id: params.id });
  }

  async removeChart(params: { id: string }): Promise<void> {
    return this.call<void>('removeChart', { id: params.id });
  }

  async removeProtection(params: { id: string }): Promise<void> {
    return this.call<void>('removeProtection', { id: params.id });
  }

  async removeRule(params: { id: string }): Promise<void> {
    return this.call<void>('removeRule', { id: params.id });
  }

  async renamePrivateSheet(params: { sheet_id: string; name: string }): Promise<void> {
    return this.call<void>('renamePrivateSheet', { sheetId: params.sheet_id, name: params.name });
  }

  async renameSheet(params: { sheet_id: string; new_name: string }): Promise<void> {
    return this.call<void>('renameSheet', { sheetId: params.sheet_id, newName: params.new_name });
  }

  async searchFunctions(params: { prefix: string }): Promise<FunctionDef[]> {
    return this.view<FunctionDef[]>('searchFunctions', { prefix: params.prefix });
  }

  async setCell(params: { sheet_id: string; row_id: string; col_id: string; raw_value: string }): Promise<string> {
    return this.call<string>('setCell', { sheetId: params.sheet_id, rowId: params.row_id, colId: params.col_id, rawValue: params.raw_value });
  }

  async setCellFormat(params: { sheet_id: string; row_id: string; col_id: string; format: string }): Promise<string> {
    return this.call<string>('setCellFormat', { sheetId: params.sheet_id, rowId: params.row_id, colId: params.col_id, format: params.format });
  }

  async setCommentResolved(params: { id: string; resolved: boolean }): Promise<void> {
    return this.call<void>('setCommentResolved', { id: params.id, resolved: params.resolved });
  }

  async setFrozen(params: { sheet_id: string; rows: number; cols: number }): Promise<void> {
    return this.call<void>('setFrozen', { sheetId: params.sheet_id, rows: params.rows, cols: params.cols });
  }

  async setNamedRange(params: { name: string; target: string }): Promise<void> {
    return this.call<void>('setNamedRange', { name: params.name, target: params.target });
  }

  async setRole(params: { member_id: string; role: string }): Promise<void> {
    return this.call<void>('setRole', { memberId: params.member_id, role: params.role });
  }

  async setSizes(params: { sheet_id: string; sizes: AxisSize[] }): Promise<void> {
    return this.call<void>('setSizes', { sheetId: params.sheet_id, sizes: params.sizes });
  }

  async unlink(params: { id: string }): Promise<void> {
    return this.call<void>('unlink', { id: params.id });
  }

  async updateChart(params: { id: string; chart: ChartInput }): Promise<void> {
    return this.call<void>('updateChart', { id: params.id, chart: params.chart });
  }

  async updateProtection(params: { id: string; description: string; editors: string[] }): Promise<void> {
    return this.call<void>('updateProtection', { id: params.id, description: params.description, editors: params.editors });
  }

  async updateRule(params: { id: string; rule: RuleInput }): Promise<void> {
    return this.call<void>('updateRule', { id: params.id, rule: params.rule });
  }

  async whoami(): Promise<string> {
    return this.view<string>('whoami', {});
  }
}
