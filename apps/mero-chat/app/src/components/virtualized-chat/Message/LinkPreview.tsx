import { memo, useMemo } from "react";
import styled from "styled-components";

import {
  extractUrls,
  toLocalPreview,
  type LocalPreview,
} from "./linkPreviewModel";

// A link card built from the URL alone. Nothing is fetched: a preview service
// would see every link a user posts, and a node's or cluster's CSP blocks
// other hosts anyway. No favicon or thumbnail either, since images from other
// hosts are blocked too.

const MAX_PREVIEWS = 3;

// ─── Styled components ──────────────────────────────────────────────────────

const PreviewCard = styled.a`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  padding: 8px 12px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--glass-ink) 8%, transparent);
  background: color-mix(in srgb, var(--glass-ink) 3%, transparent);
  border-left: 3px solid var(--glass-accent);
  text-decoration: none;
  max-width: 480px;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: color-mix(in srgb, var(--glass-ink) 6%, transparent);
  }
`;

const PreviewIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  flex-shrink: 0;
  color: var(--glass-accent);
  background: color-mix(in srgb, var(--glass-accent) 12%, transparent);
`;

const PreviewText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const PreviewTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: var(--glass-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PreviewDescription = styled.div`
  font-size: 11px;
  color: color-mix(in srgb, var(--glass-ink) 55%, transparent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

function LinkIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z" />
    </svg>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

interface LinkPreviewProps {
  html: string;
}

function LinkPreview({ html }: LinkPreviewProps) {
  const previews = useMemo(
    () =>
      extractUrls(html)
        .slice(0, MAX_PREVIEWS)
        .map(toLocalPreview)
        .filter((p): p is LocalPreview => p !== null),
    [html],
  );

  if (previews.length === 0) return null;

  return (
    <>
      {previews.map((p) => (
        <PreviewCard
          key={p.url}
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          title={p.url}
          data-testid="link-preview"
        >
          <PreviewIcon>{p.youtubeId ? <PlayIcon /> : <LinkIcon />}</PreviewIcon>
          <PreviewText>
            <PreviewTitle>
              {p.youtubeId ? "YouTube video" : p.host}
            </PreviewTitle>
            {p.youtubeId ? (
              <PreviewDescription>{`${p.host} · ${p.youtubeId}`}</PreviewDescription>
            ) : (
              p.path && <PreviewDescription>{p.path}</PreviewDescription>
            )}
          </PreviewText>
        </PreviewCard>
      ))}
    </>
  );
}

export default memo(LinkPreview);
