import { Link } from "react-router-dom";

import type { PostView } from "../generated/ForumClient";
import { timeAgo } from "../lib/forum";
import { authorLabel, shortAccount } from "../lib/nickname";

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
    <div className="votes">
      <button
        className="vote up"
        aria-label="Upvote"
        aria-pressed={myVote === 1}
        onClick={() => onVote(myVote === 1 ? 0 : 1)}
      >
        ▲
      </button>
      <span className="score">{score}</span>
      <button
        className="vote down"
        aria-label="Downvote"
        aria-pressed={myVote === -1}
        onClick={() => onVote(myVote === -1 ? 0 : -1)}
      >
        ▼
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
      {a.isSelf && <span className="youTag"> (you)</span>}
    </span>
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
      <VoteColumn score={post.score} myVote={post.my_vote} onVote={onVote} />
      <div className="body">
        <h2 className="title">
          <Link to={`/p/${post.id}`}>{post.title}</Link>
        </h2>
        <div className="meta">
          <Byline
            account={post.author}
            authorName={post.author_name}
            selfAccount={selfAccount}
          />
          <span>·</span>
          <span>{timeAgo(post.created_at)}</span>
          <span>·</span>
          <Link to={`/p/${post.id}`}>
            {post.comment_count}{" "}
            {post.comment_count === 1 ? "comment" : "comments"}
          </Link>
          {mine && onDelete && (
            <>
              <span>·</span>
              <button
                className="linkBtn danger"
                data-testid="delete-post"
                onClick={() => {
                  // A post can carry a thread of other people's replies, so
                  // this asks. Comments do not, and do not.
                  if (confirm("Delete this post? Its comments go with it."))
                    onDelete();
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
