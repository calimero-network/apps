// Builds a link card from the URL alone: no request, no remote image.

const MAX_PATH = 60;

export interface LocalPreview {
  url: string;
  host: string;
  /** Path, query and hash, tidied; "" for a bare origin. */
  path: string;
  youtubeId: string | null;
}

export function extractYouTubeId(url: string): string | null {
  const m = url.match(
    /^https?:\/\/(?:(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?![a-zA-Z0-9_-])/,
  );
  return m?.[1] ?? null;
}

export function toLocalPreview(href: string): LocalPreview | null {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.replace(/^www\./, "");
  if (!host) return null;
  let path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (path === "/") path = "";
  path = path.replace(/\/$/, "");
  try {
    path = decodeURI(path);
  } catch {
    /* keep it encoded */
  }
  if (path.length > MAX_PATH) path = `${path.slice(0, MAX_PATH - 1)}…`;
  return {
    url: parsed.href,
    host,
    path,
    youtubeId: extractYouTubeId(parsed.href),
  };
}

export function extractUrls(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const urls: string[] = [];
  doc.querySelectorAll("a[href]").forEach((el) => {
    const href = (el as HTMLAnchorElement).href;
    if (href.startsWith("http://") || href.startsWith("https://"))
      urls.push(href);
  });
  return [...new Set(urls)];
}
