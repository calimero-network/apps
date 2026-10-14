import { useEffect, useState, type ReactNode } from "react";

/**
 * The markdown a chat bubble shows: paragraphs, lists, headings (as bold
 * lines), bold, italic, inline code, fenced code blocks and links.
 *
 * It builds React elements from the text and never hands the browser HTML, so
 * anything that looks like a tag (`<script>`, `<img onerror>`) shows as the
 * characters it is. Links open in a new tab, and only http, https and mailto
 * ones become links at all: a `javascript:` link stays text.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={className}>{blocks(text)}</div>;
}

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const ITEM = /^\s*([-*+]|\d{1,9}[.)])\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

function blocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const key = out.length;

    const fence = FENCE.exec(line);
    if (fence) {
      const open = fence[1]!;
      // Closed by a bare fence of the same character, at least as long.
      const closes = (l: string) => {
        const t = l.trim();
        return t.length >= open.length && t === open[0]!.repeat(t.length);
      };
      const code: string[] = [];
      i++;
      while (i < lines.length && !closes(lines[i]!)) {
        code.push(lines[i]!);
        i++;
      }
      i++; // the closing fence, or past the end when it never closed
      out.push(<CodeBlock key={key} code={code.join("\n")} lang={fence[2] ?? ""} />);
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      out.push(
        <p key={key} className="md-heading">
          <strong>{inline(heading[1]!)}</strong>
        </p>,
      );
      i++;
      continue;
    }

    const first = ITEM.exec(line);
    if (first) {
      const ordered = /\d/.test(first[1]!);
      const items: string[] = [];
      while (i < lines.length) {
        const m = ITEM.exec(lines[i]!);
        if (m && /\d/.test(m[1]!) === ordered) {
          items.push(m[2]!);
          i++;
        } else if (m || !lines[i]!.trim() || FENCE.test(lines[i]!) || HEADING.test(lines[i]!)) {
          // A blank line ends the list unless the next item carries it on.
          if (!lines[i]!.trim()) {
            const next = ITEM.exec(lines[i + 1] ?? "");
            if (next && /\d/.test(next[1]!) === ordered) {
              i++;
              continue;
            }
          }
          break;
        } else {
          // A wrapped line belongs to the item above it.
          items[items.length - 1] += `\n${lines[i]!.trim()}`;
          i++;
        }
      }
      const children = items.map((t, n) => <li key={n}>{inline(t)}</li>);
      const start = ordered ? parseInt(first[1]!, 10) : 1;
      out.push(
        ordered ? (
          <ol key={key} start={start === 1 ? undefined : start}>
            {children}
          </ol>
        ) : (
          <ul key={key}>{children}</ul>
        ),
      );
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !FENCE.test(lines[i]!) && !ITEM.test(lines[i]!) && !HEADING.test(lines[i]!)) {
      para.push(lines[i]!);
      i++;
    }
    out.push(<p key={key}>{inline(para.join("\n"))}</p>);
  }
  return out;
}

/**
 * Inline marks, the leftmost first: `code`, [text](url), a bare URL,
 * **bold** / __bold__, *italic* / _italic_.
 */
const INLINE =
  /`([^`\n]+)`|\[([^\]\n]+)\]\(([^()\s]+)\)|(https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]*_])|\*\*(?=\S)([^\n]+?)\*\*|__(?=\S)([^\n]+?)__|\*(?=[^\s*])([^*\n]+?)\*|(?<![\w])_(?=[^\s_])([^_\n]+?)_(?!\w)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    const key = out.length;
    const [whole, code, label, href, bare, bold1, bold2, em1, em2] = m;
    if (code !== undefined) out.push(<code key={key}>{code}</code>);
    else if (label !== undefined) out.push(<Link key={key} href={href!} fallback={whole}>{inline(label)}</Link>);
    else if (bare !== undefined) out.push(<Link key={key} href={bare} fallback={bare}>{bare}</Link>);
    else if (bold1 !== undefined || bold2 !== undefined) out.push(<strong key={key}>{inline((bold1 ?? bold2)!)}</strong>);
    else out.push(<em key={key}>{inline((em1 ?? em2)!)}</em>);
    last = at + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A link only to the web or to mail: anything else (javascript:, data:) is not one. */
export function safeHref(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? url.href : null;
  } catch {
    return null;
  }
}

function Link({ href, fallback, children }: { href: string; fallback: string; children: ReactNode }) {
  const safe = safeHref(href);
  if (!safe) return <>{fallback}</>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1_500);
    return () => window.clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // No clipboard (an insecure page, a refused permission): the code is still there to select.
    }
  };
  return (
    <div className="md-code">
      <button type="button" className="md-copy small ghost" aria-label={copied ? "Copied" : "Copy code"} onClick={() => void copy()}>
        {copied ? "Copied" : "Copy"}
      </button>
      <pre>
        <code data-lang={lang || undefined}>{code}</code>
      </pre>
    </div>
  );
}
