/**
 * Create a forum, or join one you were invited to.
 *
 * This screen did not exist. A freshly connected node has no namespace and no
 * context, so `useForumContext` resolved null, the feed stayed empty forever,
 * and the composer's only possible outcome was a throw. There was nothing in
 * the app that could produce the thing the app reads.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ForumWorkspace } from "../lib/workspace";
import styles from "./SetupPage.module.css";

export default function SetupPage({ ws }: { ws: ForumWorkspace }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  async function create() {
    const id = await ws.createForum(name);
    if (id) navigate("/f");
  }

  async function join() {
    await ws.joinForum(code);
    // `needsSetup` flips once discovery re-runs; navigating on a still-empty
    // workspace would bounce straight back here, so let the redirect below do
    // it once the context actually exists.
    if (!ws.joinError) setCode("");
  }

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <span className={styles.brand}>
          mero<span>forum</span>
        </span>
        <h1 className={styles.title}>No forum on this node yet</h1>
        <p className={styles.lede}>
          A forum is a namespace with one context inside it. Create one to start
          a discussion, or paste an invitation to join someone else's.
        </p>

        <section className={styles.block}>
          <h2 className={styles.blockTitle}>Create a forum</h2>
          <div className={styles.row}>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Forum name, e.g. “core team”"
              aria-label="Forum name"
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim() && !ws.createLoading) void create();
              }}
            />
            <button
              className={styles.primary}
              onClick={() => void create()}
              disabled={ws.createLoading || !name.trim()}
            >
              {ws.createLoading ? "Creating…" : "Create"}
            </button>
          </div>
          {ws.createError && <p className={styles.error}>{ws.createError}</p>}
        </section>

        <div className={styles.or}>or</div>

        <section className={styles.block}>
          <h2 className={styles.blockTitle}>Join with an invitation</h2>
          <textarea
            className={styles.textarea}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste the invitation JSON you were sent"
            aria-label="Invitation"
            rows={4}
          />
          <button
            className={styles.secondary}
            onClick={() => void join()}
            disabled={ws.joinLoading || !code.trim()}
          >
            {ws.joinLoading ? "Joining…" : "Join"}
          </button>
          {ws.joinError && <p className={styles.error}>{ws.joinError}</p>}
        </section>
      </div>
    </div>
  );
}
