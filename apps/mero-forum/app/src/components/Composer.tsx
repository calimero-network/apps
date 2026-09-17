import { useState } from "react";

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

  if (!open) {
    return (
      <div className="composer">
        <input
          placeholder="Start a discussion…"
          onFocus={() => setOpen(true)}
          aria-label="Start a discussion"
        />
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
      {error && <div className="error">{error}</div>}
      {/* Said at the moment of writing, not only in the header: by the time you
          are typing, the header has scrolled away. */}
      <p className="composerAs" data-testid="composer-as">
        {as ? (
          <>
            You are creating a post as <strong>{as}</strong>
          </>
        ) : (
          <>
            You have not picked a name — this will be signed with an account id
          </>
        )}
      </p>
      <input
        autoFocus
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Title"
      />
      <textarea
        rows={4}
        placeholder="Text"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label="Text"
      />
      <div className="row">
        <button
          className="primary"
          disabled={busy || !title.trim() || !body.trim()}
          onClick={() => void submit()}
        >
          {busy ? "Posting…" : "Post"}
        </button>
        <button
          className="ghost"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
