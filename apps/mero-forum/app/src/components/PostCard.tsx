import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { PostView } from "../generated/ForumClient";
import { timeAgo } from "../lib/forum";
import { authorLabel, shortAccount } from "../lib/nickname";
import { Avatar, Menu } from "./chrome";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  LinkIcon,
  MessageIcon,
  TrashIcon,
} from "./icons";

export function VoteColumn({
  score,
  myVote,
  onVote,
}: {
  score: number;
  myVote: number;
  onVote: (value: number) => void;
}) {
  // Clicking the arrow you already chose retracts it — the contract takes 0 for
  // "no vote", so this is one call either way rather than a separate undo.
  return (
    <div
      className="votes"
      data-mine={myVote === 1 ? "up" : myVote === -1 ? "down" : undefined}
    >
      <button
        type="button"
        className="vote up"
        aria-label="Upvote"
        title="Upvote"
        aria-pressed={myVote === 1}
        onClick={() => onVote(myVote === 1 ? 0 : 1)}
      >
        <ArrowUpIcon size={17} />
      </button>
      <span className="score">{score}</span>
      <button
        type="button"
        className="vote down"
        aria-label="Downvote"
        title="Downvote"
        aria-pressed={myVote === -1}
        onClick={() => onVote(myVote === -1 ? 0 : -1)}
      >
        <ArrowDownIcon size={17} />
      </button>
    </div>
  );
}

/**
 * The byline.
 *
 * Shared by posts and comments so a name never renders one way in the feed and
 * another in a thread. `anonymous` is carried through to the markup rather than
 * quietly substituted: an account id styled exactly like a name tells the
 * reader it IS a name.
 */
export function Byline({
  account,
  authorName,
  selfAccount,
}: {
  account: string;
  authorName: string;
  selfAccount: string | null;
}) {
  const a = authorLabel(account, authorName, selfAccount);
  return (
    <span className="author" data-anonymous={a.anonymous} title={account}>
      {a.label}
      {/* The id ALWAYS, beside the name — never instead of it and never only on
          hover.

          A nickname is a claim, not an identity: `set_nickname` lets anyone call
          themselves anything, including exactly what somebody else is called,
          and nothing in the contract prevents it or could. So a byline showing
          a name alone is forgeable by design — two people can be "ana" in the
          same thread and the reader cannot tell them apart.

          The account id is the thing that cannot be changed, so it is what
          makes the byline decidable. Rendered small and dim: it is a
          disambiguator, not the headline, and putting it in a title= attribute
          instead would hide it from exactly the reader who is being fooled. */}
      {/* Not when the label IS the id — an author with no name would otherwise
          render the same short id twice. */}
      {!a.anonymous && (
        <span className="authorId" title={account}>
          {shortAccount(account)}
        </span>
      )}
      {a.isSelf && <span className="youTag">you</span>}
    </span>
  );
}

/** The author's initials circle, coloured from the account id. */
export function AuthorAvatar({
  account,
  authorName,
  size = 40,
}: {
  account: string;
  authorName: string;
  size?: number;
}) {
  const a = authorLabel(account, authorName, null);
  return (
    <Avatar
      label={a.label}
      // Seeded by the label, so the same name has the same colour in the
      // composer, the rail and the timeline.
      seed={a.anonymous ? account : a.label}
      anonymous={a.anonymous}
      size={size}
    />
  );
}

/** Copies a permalink to the post; flips to "Copied" for a moment. */
export function ShareButton({ postId }: { postId: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      className="act share"
      data-copied={copied ? "true" : undefined}
      title={copied ? "Link copied" : "Copy link to post"}
      aria-label={copied ? "Link copied" : "Copy link to post"}
      onClick={() => {
        const url = `${window.location.origin}/p/${postId}`;
        void navigator.clipboard
          ?.writeText(url)
          .then(() => {
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => undefined);
      }}
    >
      <span className="actIcon">
        {copied ? <CheckIcon size={17} /> : <LinkIcon size={17} />}
      </span>
      {copied ? "Copied" : null}
    </button>
  );
}

export default function PostCard({
  post,
  selfAccount,
  onVote,
  onDelete,
}: {
  post: PostView;
  selfAccount: string | null;
  onVote: (value: number) => void;
  onDelete?: () => void;
}) {
  // The contract gates delete on authorship, so offering the control to
  // somebody else would only produce a refusal they cannot act on.
  const mine = !!selfAccount && post.author === selfAccount;

  return (
    <article className="card">
      <AuthorAvatar account={post.author} authorName={post.author_name} />
      <div className="cardMain">
        <div className="byRow">
          <Byline
            account={post.author}
            authorName={post.author_name}
            selfAccount={selfAccount}
          />
          <span className="dot" aria-hidden="true">
            ·
          </span>
          <span
            className="timeMeta"
            title={new Date(post.created_at).toLocaleString()}
          >
            {timeAgo(post.created_at)}
          </span>
          <span className="grow" />
          {mine && onDelete && (
            <Menu label="Post actions">
              {(close) => (
                <button
                  type="button"
                  role="menuitem"
                  className="ui-menuItem"
                  data-danger="true"
                  data-testid="delete-post"
                  onClick={() => {
                    close();
                    // A post can carry a thread of other people's replies, so
                    // this asks. Comments do not, and do not.
                    if (confirm("Delete this post? Its comments go with it."))
                      onDelete();
                  }}
                >
                  <TrashIcon size={17} />
                  Delete
                </button>
              )}
            </Menu>
          )}
        </div>
        <h2 className="title">
          <Link to={`/p/${post.id}`}>{post.title}</Link>
        </h2>
        {post.body && <p className="excerpt">{post.body}</p>}
        <div className="actions">
          <Link
            to={`/p/${post.id}`}
            className="act reply"
            aria-label={`${post.comment_count} ${post.comment_count === 1 ? "comment" : "comments"}`}
            title="Reply"
          >
            <span className="actIcon">
              <MessageIcon size={17} />
            </span>
            {post.comment_count}
          </Link>
          <VoteColumn
            score={post.score}
            myVote={post.my_vote}
            onVote={onVote}
          />
          <ShareButton postId={post.id} />
        </div>
      </div>
    </article>
  );
}
