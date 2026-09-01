import { Link } from "react-router-dom";

import type { PostView } from "../generated/ForumClient";
import { shortAuthor, timeAgo } from "../lib/forum";

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

export default function PostCard({
  post,
  onVote,
}: {
  post: PostView;
  onVote: (value: number) => void;
}) {
  return (
    <article className="card">
      <VoteColumn score={post.score} myVote={post.my_vote} onVote={onVote} />
      <div className="body">
        <h2 className="title">
          <Link to={`/p/${post.id}`}>{post.title}</Link>
        </h2>
        <div className="meta">
          <span>{shortAuthor(post.author)}</span>
          <span>·</span>
          <span>{timeAgo(post.created_at)}</span>
          <span>·</span>
          <Link to={`/p/${post.id}`}>
            {post.comment_count} {post.comment_count === 1 ? "comment" : "comments"}
          </Link>
        </div>
      </div>
    </article>
  );
}
