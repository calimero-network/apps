import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActionSetView,
  Attachment,
  CheckpointView,
  FeedItem,
  FeedPage,
  Folder,
  LensView,
  LinkView,
  PrView,
  PushDeviceInput,
  PushDeviceView,
  PushKeyView,
  SettingsView,
  WatchView,
} from "./generated/HyperfeedClient";
import type { NameLink } from "./links";
import { fillReplyCall } from "./lens/lens";
import type { ActionMode, AgentMode, Decision, FeedBackend, Filter, NotificationMode } from "./backend";
import type { BlobStore } from "./attachments";

export interface Feed {
  page: FeedPage | null;
  settings: SettingsView | null;
  /** What your agent learned for each app version, newest first. */
  lenses: LensView[];
  /** What your agent can do in each app version, newest first; [] on a feed made before actions. */
  actionSets: ActionSetView[];
  /**
   * The feed was made by a Hyperfeed from before lenses: it works, but holds
   * no lenses or typed rows until it is created again with the latest one.
   */
  outdated: boolean;
  error: string | null;
  busy: boolean;
  filter: Filter;
  appKey: string;
  setFilter: (f: Filter) => void;
  setAppKey: (k: string) => void;
  refresh: () => Promise<void>;
  dismissError: () => void;
  /** Decide on an action; `answer` is the option or text for a proposal with an ask. */
  resolve: (id: string, decision: Decision, answer?: string) => Promise<void>;
  /**
   * Answer a notification in place. A typed row with a reply call is carried
   * out right here, in the source app, and reported delivered or failed; any
   * other answer waits for your agent.
   */
  answer: (id: string, answer: string) => Promise<void>;
  decideLens: (appKey: string, applicationId: string, decision: "approve" | "reject") => Promise<void>;
  decideActions: (appKey: string, applicationId: string, decision: "approve" | "reject") => Promise<void>;
  /** Set one action apart from its app's mode; absent on a feed made before actions. */
  setActionMode?: (appKey: string, action: string, mode: ActionMode) => Promise<void>;
  /**
   * Talk to your agent about a chain ("" starts a new one). Resolves to your
   * message, so the caller can open its chain; null when the node refused it.
   */
  say: (chain: string, text: string, attachments?: Attachment[], mode?: string) => Promise<FeedItem | null>;
  /** Answer one of your agent's questions from its buttons: your next message in its chain. */
  answerAsk: (item: FeedItem, text: string) => Promise<void>;
  /** Where images on your messages are kept; null when this feed can't hold them. */
  images: BlobStore | null;
  /** Ask your agent to stop working on one of your messages: it ends the turn, "Stopped by you". */
  stop: (id: string) => Promise<void>;
  /**
   * Your chats with your agent, newest first: the chains the feed leads with a
   * message, and those waiting on (or running) an approval in a chat. Each
   * comes as its latest message. A read, like `loadChain`.
   */
  chats: () => Promise<FeedItem[]>;
  /** Everything that waits on you, one row per chain, newest first, whatever the feed's filter. A read. */
  needsYou: () => Promise<FeedItem[]>;
  /** The chats you archived, newest first, as `chats` gives them. A read. */
  archivedChats: () => Promise<FeedItem[]>;
  /** Every row in a chain, oldest first. A read: no busy state, no refresh. */
  loadChain: (chain: string) => Promise<FeedItem[]>;
  /** Where the task in a chain stands, as your agent last wrote it, or null. A read, like `loadChain`. */
  loadCheckpoint?: (chain: string) => Promise<CheckpointView | null>;
  /** The watches in a chain ("when X, do Y"), oldest first. A read, like `loadChain`. */
  loadWatches?: (chain: string) => Promise<WatchView[]>;
  /** Cancel a watch that has not fired yet. */
  cancelWatch?: (id: string) => Promise<void>;
  /** A PR card's Merge: a merge watch on the chain, fired by your agent's runtime once every check passed. */
  mergeWhenGreen?: (chain: string, repo: string, pr: number) => Promise<void>;
  /** The PRs your agent's runtime saw on GitHub (`""`: every chain). A read, like `loadChain`. */
  loadPrs?: (chain: string) => Promise<PrView[]>;
  /** A task's links, oldest first. A read, like `loadChain`. */
  loadLinks?: (chain: string) => Promise<LinkView[]>;
  /** A link's name from the thing itself ("#launch", "DM with Ronit"), `""` when it cannot say; absent off a node. */
  nameLink?: NameLink;
  /** Link a thing to a task by hand; absent when the feed predates links. */
  addLink?: (chain: string, subject: string, label: string) => Promise<void>;
  /** Take a link off a task. */
  removeLink?: (chain: string, subject: string) => Promise<void>;
  /** Push to your phone: the runtime's key and the devices it wakes; null when the feed predates push. A read. */
  loadPush?: () => Promise<PushState | null>;
  /** Push to this device; absent when the feed predates push. */
  addPushDevice?: (input: PushDeviceInput) => Promise<void>;
  /** Stop pushing to a device. */
  removePushDevice?: (endpoint: string) => Promise<void>;
  markSeen: (ids: string[]) => Promise<void>;
  markAllSeen: () => Promise<void>;
  setPolicy: (appKey: string, agent: AgentMode, notifications: NotificationMode) => Promise<void>;
  setGuard: (category: string, enabled: boolean) => Promise<void>;
  /** Only on a feed that keeps what each agent may reach. */
  setAccess?: (agent: string, folders: Folder[], shell: boolean, web: boolean) => Promise<void>;
  /** Which agent works in an app; absent on a feed made before assignments. */
  setAssignment?: (app: string, agent: string) => Promise<void>;
  /** Agents with accounts of their own (cloud agents); absent on a feed made before them. */
  addAgentAccount?: (account: string, name: string) => Promise<void>;
  removeAgentAccount?: (account: string) => Promise<void>;
  setPaused: (paused: boolean) => Promise<void>;
  /** Your standing rules: add one, remove one, or approve or dismiss one your agent suggested. */
  addRule: (text: string) => Promise<void>;
  removeRule: (id: string) => Promise<void>;
  /** Your rules for one agent only; absent on a feed made before them. */
  addAgentRule?: (agent: string, text: string) => Promise<void>;
  removeAgentRule?: (id: string) => Promise<void>;
  approveRule: (id: string) => Promise<void>;
  dismissRule: (id: string) => Promise<void>;
  /** Put chains away (they come back when something new happens in them); undoable. False when the node refused it. */
  archive: (chains: string[], label?: string) => Promise<boolean>;
  /** Put a chain away until `until` (ms); undoable. */
  later: (chain: string, until: number, label?: string) => Promise<void>;
  unarchive: (chains: string[]) => Promise<void>;
  /** The last thing you put away, with its undo, until the next one or a few seconds pass. */
  toast: { text: string; undo: () => void } | null;
  dismissToast: () => void;
}

/** Where push to your phone stands: the key to subscribe with, and the devices already subscribed. */
export interface PushState {
  key: PushKeyView;
  devices: PushDeviceView[];
}

/** How long the undo for something you put away stays offered. */
export const TOAST_MS = 5_000;

/**
 * Re-read when nothing arrived, for a change made while the event stream was
 * reconnecting: a missed event is never replayed.
 */
const POLL_MS = 15_000;

/**
 * One feed, kept current.
 *
 * There is no optimistic update: an approval is only an approval once the
 * contract has taken it, and every call is followed by a re-read. `nudge` is
 * how the caller says "something changed" — an event on the feed's context, or
 * the demo's own change listener.
 */
export function useFeed(backend: FeedBackend | null, nudge: number): Feed {
  const [page, setPage] = useState<FeedPage | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [lenses, setLenses] = useState<LensView[]>([]);
  const [actionSets, setActionSets] = useState<ActionSetView[]>([]);
  const [outdated, setOutdated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [appKey, setAppKey] = useState("");
  const [toast, setToast] = useState<{ text: string; undo: () => void } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  // A burst of events (an action and its status change) must not fire a read
  // per event; one in flight is enough, and the trailing one is kept.
  const reading = useRef(false);
  const again = useRef(false);
  // The error the last read set, so a good read clears only its own: an
  // action's refusal stays up after the re-read that follows it.
  const readError = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!backend) return;
    if (reading.current) {
      again.current = true;
      return;
    }
    reading.current = true;
    try {
      do {
        again.current = false;
        // An older feed has no `lenses`: the rest of it still reads.
        const lensesOrOld = backend.lenses().catch((e: unknown) => {
          if (/method "?lenses"? not found/i.test(messageOf(e))) return null;
          throw e;
        });
        const actionsOrNone = backend.actionSets ? backend.actionSets() : Promise.resolve([]);
        const [p, s, l, a] = await Promise.all([backend.feed(filter, appKey), backend.settings(), lensesOrOld, actionsOrNone]);
        setPage(p);
        setSettings(s);
        setLenses(l ?? []);
        setActionSets(a);
        setOutdated(l === null);
        const stale = readError.current;
        readError.current = null;
        setError((now) => (now === stale ? null : now));
      } while (again.current);
    } catch (e) {
      readError.current = messageOf(e);
      setError(readError.current);
    } finally {
      reading.current = false;
    }
  }, [backend, filter, appKey]);

  useEffect(() => {
    void refresh();
  }, [refresh, nudge]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = useCallback(
    async (fn: (b: FeedBackend) => Promise<unknown>) => {
      if (!backend) return;
      setBusy(true);
      setError(null);
      try {
        await fn(backend);
      } catch (e) {
        setError(refusalOf(e));
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [backend, refresh],
  );

  const mergeWhenGreen = useCallback(
    (chain: string, repo: string, pr: number) => run((b) => (b.mergeWhenGreen ? b.mergeWhenGreen(chain, repo, pr) : Promise.resolve())),
    [run],
  );
  const setAccess = useCallback(
    (agent: string, folders: Folder[], shell: boolean, web: boolean) =>
      run((b) => (b.setAccess ? b.setAccess(agent, folders, shell, web) : Promise.resolve())),
    [run],
  );
  const setActionMode = useCallback(
    (app: string, action: string, mode: ActionMode) =>
      run((b) => (b.setActionMode ? b.setActionMode(app, action, mode) : Promise.resolve())),
    [run],
  );
  const setAssignment = useCallback(
    (app: string, agent: string) => run((b) => (b.setAssignment ? b.setAssignment(app, agent) : Promise.resolve())),
    [run],
  );
  const addAgentAccount = useCallback(
    (account: string, name: string) =>
      run((b) => (b.addAgentAccount ? b.addAgentAccount(account, name) : Promise.resolve())),
    [run],
  );
  const removeAgentAccount = useCallback(
    (account: string) => run((b) => (b.removeAgentAccount ? b.removeAgentAccount(account) : Promise.resolve())),
    [run],
  );
  const addAgentRule = useCallback(
    (agent: string, text: string) => run((b) => (b.addAgentRule ? b.addAgentRule(agent, text) : Promise.resolve())),
    [run],
  );
  const removeAgentRule = useCallback(
    (id: string) => run((b) => (b.removeAgentRule ? b.removeAgentRule(id) : Promise.resolve())),
    [run],
  );
  const addLink = useCallback(
    (chain: string, subject: string, label: string) =>
      run((b) => (b.addLink ? b.addLink(chain, subject, label).then(() => undefined) : Promise.resolve())),
    [run],
  );
  const removeLink = useCallback(
    (chain: string, subject: string) => run((b) => (b.removeLink ? b.removeLink(chain, subject) : Promise.resolve())),
    [run],
  );
  const addPushDevice = useCallback(
    (input: PushDeviceInput) => run((b) => (b.addPushDevice ? b.addPushDevice(input) : Promise.resolve())),
    [run],
  );
  const removePushDevice = useCallback(
    (endpoint: string) => run((b) => (b.removePushDevice ? b.removePushDevice(endpoint) : Promise.resolve())),
    [run],
  );
  const loadPush = useCallback(async (): Promise<PushState | null> => {
    if (!backend?.pushKey || !backend.pushDevices) return null;
    const key = await backend.pushKey();
    if (!key) return null;
    return { key, devices: await backend.pushDevices() };
  }, [backend]);

  return {
    page,
    settings,
    lenses,
    actionSets,
    outdated,
    error,
    busy,
    filter,
    appKey,
    setFilter,
    setAppKey,
    refresh,
    dismissError: useCallback(() => setError(null), []),
    resolve: useCallback(
      (id, decision, answer) =>
        run(async (b) => {
          const item = await b.resolveAction(id, decision, answer);
          // A draft for you to send: approving it sends it, from here, as you.
          if (item.reply_call && (item.status === "approved" || item.status === "retrying")) {
            await send(b, item, answer ?? "");
          }
        }),
      [run],
    ),
    answer: useCallback(
      (id, answer) =>
        run(async (b) => {
          const item = await b.answerNotification(id, answer);
          if (item.reply_call) await deliver(b, item, answer);
        }),
      [run],
    ),
    decideLens: useCallback(
      (appKey, applicationId, decision) => run((b) => b.decideLens(appKey, applicationId, decision)),
      [run],
    ),
    decideActions: useCallback(
      (appKey, applicationId, decision) =>
        run((b) => (b.decideActions ? b.decideActions(appKey, applicationId, decision) : Promise.resolve())),
      [run],
    ),
    setActionMode: backend?.setActionMode ? setActionMode : undefined,
    say: useCallback(
      async (chain, text, attachments, mode) => {
        let posted: FeedItem | null = null;
        await run(async (b) => {
          posted = await b.say(chain, text, attachments, mode);
        });
        return posted;
      },
      [run],
    ),
    answerAsk: useCallback((item, text) => run((b) => b.answerAsk(item.id, item.chain, text)), [run]),
    images: backend?.images ?? null,
    stop: useCallback((id) => run((b) => b.stop(id)), [run]),
    chats: useCallback(async () => (backend ? chatsOf(backend, "agent") : []), [backend]),
    archivedChats: useCallback(async () => (backend ? chatsOf(backend, "archived") : []), [backend]),
    needsYou: useCallback(
      async () => (backend ? (await backend.feed("needs_you", "")).items.filter((i) => i.needs_you) : []),
      [backend],
    ),
    loadChain: useCallback(async (chain) => (backend ? backend.chain(chain) : []), [backend]),
    loadCheckpoint: useCallback(async (chain: string) => (backend?.checkpoint ? backend.checkpoint(chain) : null), [backend]),
    loadWatches: useCallback(async (chain: string) => (backend?.watches ? backend.watches(chain) : []), [backend]),
    cancelWatch: useCallback((id: string) => run((b) => (b.cancelWatch ? b.cancelWatch(id) : Promise.resolve())), [run]),
    // Only a feed that keeps watches has it; without, a card's Merge asks your agent in the chat.
    mergeWhenGreen: backend?.mergeWhenGreen ? mergeWhenGreen : undefined,
    loadPrs: useCallback(async (chain: string) => (backend?.prs ? backend.prs(chain) : []), [backend]),
    loadLinks: useCallback(async (chain: string) => (backend?.links ? backend.links(chain) : []), [backend]),
    addLink: backend?.addLink ? addLink : undefined,
    removeLink: backend?.removeLink ? removeLink : undefined,
    loadPush: backend?.pushKey ? loadPush : undefined,
    addPushDevice: backend?.addPushDevice ? addPushDevice : undefined,
    removePushDevice: backend?.removePushDevice ? removePushDevice : undefined,
    markSeen: useCallback((ids) => run((b) => b.markSeen(ids)), [run]),
    markAllSeen: useCallback(() => run((b) => b.markAllSeen()), [run]),
    setPolicy: useCallback((k, agent, notifications) => run((b) => b.setPolicy(k, agent, notifications)), [run]),
    setGuard: useCallback((category, enabled) => run((b) => b.setGuard(category, enabled)), [run]),
    setAccess: backend?.setAccess ? setAccess : undefined,
    setAssignment: backend?.setAssignment ? setAssignment : undefined,
    addAgentAccount: backend?.addAgentAccount ? addAgentAccount : undefined,
    removeAgentAccount: backend?.removeAgentAccount ? removeAgentAccount : undefined,
    setPaused: useCallback((paused) => run((b) => b.setPaused(paused)), [run]),
    addRule: useCallback((text) => run((b) => b.addRule(text)), [run]),
    removeRule: useCallback((id) => run((b) => b.removeRule(id)), [run]),
    addAgentRule: backend?.addAgentRule ? addAgentRule : undefined,
    removeAgentRule: backend?.removeAgentRule ? removeAgentRule : undefined,
    approveRule: useCallback((id) => run((b) => b.approveRule(id)), [run]),
    dismissRule: useCallback((id) => run((b) => b.dismissRule(id)), [run]),
    archive: useCallback(
      async (chains, label) => {
        let ok = false;
        await run(async (b) => {
          await b.archive(chains, 0);
          ok = true;
        });
        if (!ok) return false;
        window.clearTimeout(toastTimer.current);
        setToast({
          text: label ?? (chains.length === 1 ? "Archived" : `Archived ${chains.length}`),
          undo: () => {
            setToast(null);
            void run((b) => b.unarchive(chains));
          },
        });
        toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
        return true;
      },
      [run],
    ),
    later: useCallback(
      async (chain, until, label) => {
        let ok = false;
        await run(async (b) => {
          await b.archive([chain], until);
          ok = true;
        });
        if (!ok) return;
        window.clearTimeout(toastTimer.current);
        setToast({
          text: label ?? "Back later",
          undo: () => {
            setToast(null);
            void run((b) => b.unarchive([chain]));
          },
        });
        toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
      },
      [run],
    ),
    unarchive: useCallback((chains) => run((b) => b.unarchive(chains)), [run]),
    toast,
    dismissToast: useCallback(() => setToast(null), []),
  };
}

/**
 * Your answer, carried out in the app it belongs to with the call the row's
 * lens wrote, then reported. A refusal is reported too: the row goes back to
 * you as failed, with the app's own words, and can be answered again.
 */
export async function deliver(b: FeedBackend, item: FeedItem, answer: string): Promise<void> {
  try {
    const call = fillReplyCall(item.reply_call, answer);
    await b.callApp(item.source_context, call.method, call.args);
  } catch (e) {
    await b.completeAnswer(item.id, "failed", messageOf(e).slice(0, 900));
    throw e;
  }
  await b.completeAnswer(item.id, "delivered", item.source_label ? `Sent in ${item.source_label}` : "Sent");
}

/**
 * A draft your agent wrote for you to send, sent as you with the call it
 * drafted, then reported. The agent never sends these. A refusal goes back to
 * you as failed, with the app's own words, and can be approved again.
 */
export async function send(b: FeedBackend, item: FeedItem, answer: string): Promise<void> {
  try {
    // The answer is your edit of the draft; with none, the draft as written.
    const call = fillReplyCall(item.reply_call, answer || item.ask.draft);
    await b.callApp(item.source_context, call.method, call.args);
  } catch (e) {
    await b.completeAction(item.id, "failed", messageOf(e).slice(0, 900));
    throw e;
  }
  await b.completeAction(item.id, "done", item.source_label ? `Sent in ${item.source_label}` : "Sent");
}

/** The item a list row refers to, or the first one when nothing is picked. */
export function pickSelected(items: FeedItem[], selected: string | null): FeedItem | null {
  return items.find((i) => i.id === selected) ?? items[0] ?? null;
}

/** What an action's refusal says to you; a method the feed lacks means an older feed. */
function refusalOf(e: unknown): string {
  const m = messageOf(e);
  return /method "?\w+"? not found/i.test(m)
    ? "Your feed was made by an earlier Hyperfeed and can't do this. Create a new feed to use it."
    : m;
}

/** A contract refusal is a sentence; anything else gets one. */
export function messageOf(e: unknown): string {
  // An app's refusal arrives as `{ type: "FunctionCallError", data: "<its words>" }`.
  const data = (e as { data?: unknown } | null)?.data;
  if (typeof data === "string" && data) return data.replace(/^the method call returned an error:\s*/, "").replace(/^"|"$/g, "");
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Something went wrong talking to the node.";
}

/**
 * Your chats, newest first, each as its latest message. The feed leads a chain
 * with what needs you, then with what is underway, so a chat waiting on your
 * approval (or running what you approved) leads with that action: its thread
 * is read to find the chat, which stays listed, marked as needing you.
 */
async function chatsOf(backend: FeedBackend, filter: Filter): Promise<FeedItem[]> {
  const leads = (await backend.feed(filter, "")).items;
  const chats = await Promise.all(
    leads.map(async (lead) => {
      if (lead.kind === "message") return lead;
      if (lead.kind !== "action" || !(lead.needs_you || ACTION_UNDERWAY.includes(lead.status))) return null;
      const said = (await backend.chain(lead.chain).catch(() => [])).filter((i) => i.kind === "message");
      const last = said[said.length - 1];
      return last ? { ...last, chain_len: lead.chain_len, chain_at: lead.chain_at, needs_you: lead.needs_you } : null;
    }),
  );
  return chats.filter((c): c is FeedItem => c !== null);
}

/** An action's statuses while it runs, as the contract's `underway` counts them. */
const ACTION_UNDERWAY = ["approved", "retrying", "undo_requested"];
