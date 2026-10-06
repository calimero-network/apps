import { useState } from "react";
import { Avatar } from "./chrome";

/** New post. Collapsed to a single line until focused, so the feed stays the
 *  first thing on the page. */
export default function Composer({
  onSubmit,
  as,
}: {
  onSubmit: (title: string, body: string) => Promise<void>;
  /** The name this post will carry. "" when none has been chosen. */
  as?: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const avatar = (
    <Avatar label={as || "You"} seed={as || "you"} anonymous={false} />
  );

  if (!open) {
    return (
      <div className="composer composerCollapsed">
        {avatar}
        <div className="composerMain">
          <input
            id="composer-start"
            placeholder="Start a discussion…"
            onFocus={() => setOpen(true)}
            aria-label="Start a discussion"
          />
        </div>
      </div>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(title.trim(), body.trim());
      setTitle("");
      setBody("");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer">
      {avatar}
      <div className="composerMain">
        {error && <div className="error">{error}</div>}
        <input
          autoFocus
          className="titleInput"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Title"
        />
        <textarea
          rows={3}
          placeholder="What do you want to talk about?"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-label="Text"
        />
        <div className="composerBar">
          {/* Said at the moment of writing, not only in the sidebar. */}
          <p
            className="composerAs"
            data-testid="composer-as"
            data-unset={as ? undefined : "true"}
          >
            {as ? (
              <>
                You are creating a post as <strong>{as}</strong>
              </>
            ) : (
              <>
                You have not picked a name — this will be signed with an account
                id
              </>
            )}
          </p>
          <span className="grow" />
          <button
            className="ghost"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || !title.trim() || !body.trim()}
            onClick={() => void submit()}
          >
            {busy ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}
