import { memo, useEffect, useState } from "react";
import styled from "styled-components";

interface OgData {
  title: string;
  image: string;
  description: string;
  url: string;
}

// Module-level cache so the same URL is only fetched once per session
const ogCache = new Map<string, OgData | null>();

function extractYouTubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?.*?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  );
  return m?.[1] ?? null;
}

async function fetchOgData(url: string): Promise<OgData | null> {
  if (ogCache.has(url)) return ogCache.get(url)!;

  try {
    const ytId = extractYouTubeId(url);
    if (ytId) {
      const resp = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!resp.ok) throw new Error("oembed failed");
      const data = (await resp.json()) as { title: string; author_name?: string };
      const result: OgData = {
        title: data.title,
        description: data.author_name ? `YouTube · ${data.author_name}` : "YouTube",
        image: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
        url,
      };
      ogCache.set(url, result);
      return result;
    }

    // General OG fetch via allorigins proxy
    const proxyResp = await fetch(
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!proxyResp.ok) throw new Error("proxy failed");
    const html = await proxyResp.text();

    const pick = (patterns: RegExp[]) => {
      for (const re of patterns) {
        const m = html.match(re);
        if (m?.[1]) return m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
      }
      return "";
    };

    const title = pick([
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      /<title[^>]*>([^<]+)<\/title>/i,
    ]);
    const image = pick([
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    ]);
    const description = pick([
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    ]);

    if (!title && !image) {
      ogCache.set(url, null);
      return null;
    }

    const result: OgData = { title, image, description, url };
    ogCache.set(url, result);
    return result;
  } catch {
    ogCache.set(url, null);
    return null;
  }
}

function extractUrls(html: string): string[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const urls: string[] = [];
  doc.querySelectorAll("a[href]").forEach((el) => {
    const href = (el as HTMLAnchorElement).href;
    if (href.startsWith("http://") || href.startsWith("https://")) {
      urls.push(href);
    }
  });
  return [...new Set(urls)];
}

// ─── Styled components ──────────────────────────────────────────────────────

const PreviewCard = styled.a`
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 10px;
  margin-top: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  border-left: 3px solid #a5ff11;
  text-decoration: none;
  max-width: 480px;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
  }
`;

const PreviewImage = styled.img`
  width: 80px;
  height: 56px;
  object-fit: cover;
  border-radius: 5px;
  flex-shrink: 0;
  background: #222;
`;

const PreviewText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
`;

const PreviewTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PreviewDescription = styled.div`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PreviewDomain = styled.div`
  font-size: 11px;
  color: #a5ff11;
  margin-top: 2px;
`;

// ─── Component ──────────────────────────────────────────────────────────────

interface LinkPreviewProps {
  html: string;
}

function LinkPreview({ html }: LinkPreviewProps) {
  const [previews, setPreviews] = useState<(OgData | null)[]>([]);

  useEffect(() => {
    const urls = extractUrls(html);
    if (urls.length === 0) return;

    let cancelled = false;
    void Promise.all(urls.slice(0, 3).map((u) => fetchOgData(u))).then(
      (results) => {
        if (!cancelled) setPreviews(results);
      },
    );
    return () => { cancelled = true; };
  }, [html]);

  const validPreviews = previews.filter((p): p is OgData => p !== null && !!(p.title || p.image));
  if (validPreviews.length === 0) return null;

  return (
    <>
      {validPreviews.map((p) => {
        let domain = "";
        try { domain = new URL(p.url).hostname.replace(/^www\./, ""); } catch { /* */ }
        return (
          <PreviewCard key={p.url} href={p.url} target="_blank" rel="noopener noreferrer">
            {p.image && (
              <PreviewImage
                src={p.image}
                alt=""
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <PreviewText>
              {p.title && <PreviewTitle>{p.title}</PreviewTitle>}
              {p.description && <PreviewDescription>{p.description}</PreviewDescription>}
              {domain && <PreviewDomain>{domain}</PreviewDomain>}
            </PreviewText>
          </PreviewCard>
        );
      })}
    </>
  );
}

export default memo(LinkPreview);
