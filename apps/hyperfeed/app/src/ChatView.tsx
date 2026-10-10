import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Attachment, FeedItem } from "./generated/HyperfeedClient";
import type { Feed } from "./useFeed";
import { IMAGE_TYPES, MAX_ATTACHMENTS, refuseImage, uploadImage, type BlobStore } from "./attachments";
import { NewFeedButton, type NewFeed } from "./FeedView";
import { laneOf, progressLine, statusOf, timeLabel } from "./format";
import { agentLive, notPickedUp } from "./theme";

/**
 * Chats with your agent.
 *
 * A chat is a chain the feed already keeps: your first message starts it
 * (`say("", text)`), each one after joins it, and your agent answers into it
 * with `agent_say`. So a chat started here is in the feed too, and one started
 * from the feed opens here.
 */

/** How long your message may wait before the page asks whether your agent is running. */
export const UNANSWERED_MS = 30_000;

export function ChatView({
  feed,
  chain,
  onOpen,
  newFeed,
  clock = Date.now,
}: {
  feed: Feed;
  /** The open chat's chain; "" for a new one. */
  chain: string;
  onOpen: (chain: string) => void;
  newFeed?: NewFeed;
  /** The time, for how long a message has waited. */
  clock?: () => number;
}) {
  const [chats, setChats] = useState<FeedItem[] | null>(null);
  const [thread, setThread] = useState<FeedItem[]>([]);
  // On a phone one pane shows at a time: New chat opens the empty chat.
  const [composing, setComposing] = useState(false);
  // Finished chats are out of the way until you ask for them; the open one always shows.
  const [showDone, setShowDone] = useState(false);
  // Delete asks once, in place; opening another chat drops the question.
  const [confirming, setConfirming] = useState(false);
  const { chats: listChats, loadChain, page } = feed;
  useEffect(() => setConfirming(false), [chain]);

  // `page` changes on every re-read, which follows every event on the feed:
  // the list and the open chat are read again with it.
  useEffect(() => {
    let live = true;
    void listChats().then((c) => live && setChats(c), () => live && setChats([]));
    return () => {
      live = false;
    };
  }, [listChats, page]);
  useEffect(() => {
    let live = true;
    if (!chain) setThread([]);
    else void loadChain(chain).then((t) => live && setThread(t), () => live && setThread([]));
    return () => {
      live = false;
    };
  }, [loadChain, chain, page]);

  const send = useCallback(
    async (text: string, attachments: Attachment[]) => {
      const posted = await feed.say(chain, text, attachments);
      if (!posted) return false;
      if (!chain) onOpen(posted.chain);
      else setThread(await loadChain(chain));
      return true;
    },
    [feed, chain, onOpen, loadChain],
  );

  // Deleting a chat archives its chain: it leaves your chats and your feed,
  // comes back if anything new happens in it, and can be undone.
  const remove = useCallback(async () => {
    setConfirming(false);
    // Refused (the error shows above the chat): stay on it.
    if (!(await feed.archive([chain], "Chat deleted"))) return;
    setComposing(false);
    onOpen("");
  }, [feed, chain, onOpen]);

  return (
    <div className={`chat${chain || composing ? " chat-open" : ""}`}>
      <nav className="chat-list" aria-label="Chats">
        <button
          type="button"
          className="button primary"
          onClick={() => {
            setComposing(true);
            onOpen("");
          }}
          aria-current={!chain ? "page" : undefined}
        >
          New chat
        </button>
        {chats === null ? (
          <p className="chat-hint">Loading…</p>
        ) : chats.length === 0 ? (
          <p className="chat-hint">No chats yet. Ask your agent anything and it answers here.</p>
        ) : (
          <ChatList chats={chats} open={chain} showDone={showDone} onShowDone={setShowDone}>
            {(c) => (
              <li key={c.chain}>
                <button
                  type="button"
                  className={`chat-item${c.chain === chain ? " on" : ""}`}
                  aria-current={c.chain === chain ? "page" : undefined}
                  onClick={() => {
                    setComposing(false);
                    onOpen(c.chain);
                  }}
                >
                  <span className="chat-item-text">
                    {c.from === "agent" ? "" : "You: "}
                    {c.body || c.title}
                  </span>
                  <span className="chat-item-meta">{timeLabel(c.chain_at)}</span>
                </button>
              </li>
            )}
          </ChatList>
        )}
      </nav>

      <section className="chat-main" aria-label={chain ? "Chat" : "New chat"}>
        {(chain || composing) && (
          <div className="chat-head">
            <button
              type="button"
              className="link chat-back"
              onClick={() => {
                setComposing(false);
                onOpen("");
              }}
            >
              ← Chats
            </button>
            {chain &&
              (confirming ? (
                <div className="chat-delete-confirm" role="group" aria-label="Delete this chat?">
                  <span>Delete this chat? It leaves your chats and your feed, and comes back if anything new happens in it.</span>
                  <button type="button" className="small chat-delete-yes" disabled={feed.busy} onClick={() => void remove()}>
                    Delete
                  </button>
                  <button type="button" className="small" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" className="link small chat-delete" onClick={() => setConfirming(true)}>
                  Delete chat
                </button>
              ))}
          </div>
        )}
        {feed.error && (
          <div className="error" role="alert">
            <span>{feed.error}</span>
            {feed.outdated && newFeed ? (
              <NewFeedButton newFeed={newFeed} />
            ) : (
              <button type="button" className="ghost small" onClick={feed.dismissError}>
                Dismiss
              </button>
            )}
          </div>
        )}
        <Thread
          items={thread}
          clock={clock}
          live={agentLive(feed.settings?.agents, clock())}
          busy={feed.busy}
          images={feed.images}
          onAnswer={(a) => void send(a, [])}
        />
        <Composer key={chain} busy={feed.busy} fresh={!chain} images={feed.images} onSend={send} />
      </section>

      {feed.toast && (
        <div className="toast" role="status">
          <span>{feed.toast.text}</span>
          <button type="button" className="toast-undo" onClick={feed.toast.undo}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The chats, the finished ones hidden unless you ask for them. A chat is
 * finished when nothing in it is left to you or your agent: your agent's
 * answer closed it, as the feed's Done lane counts it. The chat you have open
 * always shows, finished or not.
 */
function ChatList({
  chats,
  open,
  showDone,
  onShowDone,
  children,
}: {
  chats: FeedItem[];
  open: string;
  showDone: boolean;
  onShowDone: (show: boolean) => void;
  children: (chat: FeedItem) => ReactNode;
}) {
  const done = chats.filter((c) => laneOf(c) === "done" && c.chain !== open);
  const shown = showDone ? chats : chats.filter((c) => !done.includes(c));
  return (
    <>
      {shown.length === 0 ? <p className="chat-hint">Nothing open. Every chat is done.</p> : <ul>{shown.map(children)}</ul>}
      {done.length > 0 && (
        <button type="button" className="link small chat-done-toggle" aria-pressed={showDone} onClick={() => onShowDone(!showDone)}>
          {showDone ? "Hide done chats" : `Show done chats (${done.length})`}
        </button>
      )}
    </>
  );
}

function Thread({
  items,
  clock,
  live,
  busy,
  images,
  onAnswer,
}: {
  items: FeedItem[];
  clock: () => number;
  live: boolean;
  busy: boolean;
  images: BlobStore | null;
  /** Answer your agent's open question: your next message in the chat. */
  onAnswer: (answer: string) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const last = items[items.length - 1];
  useEffect(() => {
    // In braces: newer Chromium returns a Promise here, and an effect must
    // return nothing but its clean-up.
    end.current?.scrollIntoView?.({ block: "end" });
  }, [items.length, last?.status]);

  if (items.length === 0) {
    return (
      <div className="chat-thread chat-empty">
        <h2>Talk to your agent</h2>
        <p>Ask a question or hand it a task. It answers here, and anything it does for you also shows in your feed.</p>
      </div>
    );
  }
  return (
    <div className="chat-thread" role="log" aria-live="polite">
      {items.map((m) =>
        m.kind === "message" ? (
          <div key={m.id} className={`bubble ${m.from === "agent" ? "from-agent" : "from-you"}`}>
            <span className="sr-only">{m.from === "agent" ? "Your agent:" : "You:"}</span>
            {m.attachments?.length > 0 && <BubbleImages attachments={m.attachments} store={images} />}
            {m.body && <p>{m.body}</p>}
            {m.status === "asked" && m.ask.kind === "choose" && (
              <div className="bubble-options" role="group" aria-label={m.ask.prompt || "Your answer"}>
                {m.ask.options.map((o) => (
                  <button key={o} type="button" className="option small" disabled={busy} onClick={() => onAnswer(o)}>
                    {o}
                  </button>
                ))}
              </div>
            )}
            {m.status === "asked" && m.ask.kind === "reply" && (
              <span className="bubble-asks">{m.ask.prompt || "Your agent is waiting for your answer"} · reply below</span>
            )}
            <span className="bubble-time">{timeLabel(m.at)}</span>
          </div>
        ) : (
          <div key={m.id} className="chat-event">
            {m.title} · {statusOf(m).label}
          </div>
        ),
      )}
      {last && <Waiting last={last} clock={clock} live={live} />}
      <div ref={end} />
    </div>
  );
}

/** Where your latest message stands while your agent hasn't answered it. */
function Waiting({ last, clock, live }: { last: FeedItem; clock: () => number; live: boolean }) {
  const [, setTick] = useState(0);
  const now = clock();
  const waiting = last.kind === "message" && last.from === "you" && (last.status === "waiting" || last.status === "thinking");
  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 5_000);
    return () => window.clearInterval(t);
  }, [waiting]);

  if (last.kind !== "message" || last.from !== "you") return null;
  if (last.status === "thinking") {
    const doing = progressLine(last, now);
    return (
      <p className="chat-status busy" role="status">
        Your agent is on it…{doing && <span className="chat-doing"> {doing}</span>}
      </p>
    );
  }
  if (last.status === "failed") {
    return <p className="chat-status bad">Your agent couldn't answer{last.note ? `: ${last.note}` : "."}</p>;
  }
  if (!waiting) return null;
  if (now - last.at < UNANSWERED_MS) return <p className="chat-status">Sent · waiting for your agent</p>;
  return (
    <p className="chat-status wait">
      {notPickedUp(live)}
    </p>
  );
}

/** Object URLs for images already fetched, by blob id: a blob never changes. */
const imageUrls = new Map<string, Promise<string>>();

function imageUrl(store: BlobStore, blobId: string): Promise<string> {
  let url = imageUrls.get(blobId);
  if (!url) {
    url = store.read(blobId).then((blob) => URL.createObjectURL(blob));
    // A failed read is tried again next time, not remembered.
    url.catch(() => imageUrls.delete(blobId));
    imageUrls.set(blobId, url);
  }
  return url;
}

/** The images on a message: thumbnails, each opening full size. */
function BubbleImages({ attachments, store }: { attachments: Attachment[]; store: BlobStore | null }) {
  return (
    <div className="bubble-images">
      {attachments.map((a) => (
        <BubbleImage key={a.blob_id} attachment={a} store={store} />
      ))}
    </div>
  );
}

function BubbleImage({ attachment, store }: { attachment: Attachment; store: BlobStore | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const label = attachment.name || "Image";
  useEffect(() => {
    if (!store) return setFailed(true);
    let live = true;
    imageUrl(store, attachment.blob_id).then(
      (u) => live && setUrl(u),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [store, attachment.blob_id]);

  if (failed) return <span className="bubble-image missing">{label} · not on this node yet</span>;
  if (!url) return <span className="bubble-image loading" aria-label={`Loading ${label}`} />;
  return (
    <a className="bubble-image" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label} full size`}>
      <img src={url} alt={label} />
    </a>
  );
}

/** An image picked for the next message, before it is uploaded. */
interface Picked {
  file: File;
  preview: string;
}

function Composer({
  busy,
  fresh,
  images,
  onSend,
}: {
  busy: boolean;
  fresh: boolean;
  /** Where images go; without one, the composer takes text only. */
  images: BlobStore | null;
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [refused, setRefused] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  // The previews' object URLs go with the composer.
  useEffect(() => () => pickedRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  const add = (files: Iterable<File>) => {
    if (!images) return;
    const next = [...picked];
    let why: string | null = null;
    for (const file of files) {
      const refusal = refuseImage(file, next.length);
      if (refusal) {
        why = refusal;
        continue;
      }
      next.push({ file, preview: URL.createObjectURL(file) });
    }
    setPicked(next);
    setRefused(why);
  };
  const remove = (p: Picked) => {
    URL.revokeObjectURL(p.preview);
    setPicked((all) => all.filter((x) => x !== p));
  };

  const sendable = (text.trim() || picked.length > 0) && !busy && !uploading;
  const send = async () => {
    const t = text.trim();
    if (!sendable) return;
    let attachments: Attachment[] = [];
    if (picked.length > 0 && images) {
      setUploading(true);
      try {
        for (const p of picked) attachments.push(await uploadImage(images, p.file));
      } catch (e) {
        setRefused(`Couldn't upload the image: ${e instanceof Error ? e.message : String(e)}`);
        return;
      } finally {
        setUploading(false);
      }
    }
    if (await onSend(t, attachments)) {
      setText("");
      picked.forEach((p) => URL.revokeObjectURL(p.preview));
      setPicked([]);
      setRefused(null);
    }
  };

  return (
    <form
      className="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      onDragOver={(e) => {
        if (images && e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!images || e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        add(Array.from(e.dataTransfer.files));
      }}
    >
      {(picked.length > 0 || refused) && (
        <div className="composer-attachments">
          {picked.map((p) => (
            <span key={p.preview} className="composer-thumb">
              <img src={p.preview} alt={p.file.name || "Pasted image"} />
              <button type="button" className="composer-thumb-remove" aria-label={`Remove ${p.file.name || "image"}`} onClick={() => remove(p)}>
                ×
              </button>
            </span>
          ))}
          {refused && (
            <span className="composer-refused" role="alert">
              {refused}
            </span>
          )}
        </div>
      )}
      <div className="composer-row">
        {images && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_TYPES.join(",")}
              multiple
              hidden
              aria-label="Attach images"
              onChange={(e) => {
                add(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="ghost composer-attach"
              aria-label="Attach images"
              title="Attach images (or paste, or drop them here)"
              disabled={busy || uploading || picked.length >= MAX_ATTACHMENTS}
              onClick={() => fileInput.current?.click()}
            >
              📎
            </button>
          </>
        )}
        <label htmlFor={`${id}-say`} className="sr-only">
          Message your agent
        </label>
        <textarea
          id={`${id}-say`}
          value={text}
          rows={2}
          autoFocus
          placeholder={fresh ? "Ask a question or hand your agent a task…" : "Reply to your agent…"}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
            if (!images || files.length === 0) return;
            e.preventDefault();
            add(files);
          }}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a new line.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="button primary" disabled={!sendable}>
          {uploading ? "Uploading…" : "Send"}
        </button>
      </div>
    </form>
  );
}
