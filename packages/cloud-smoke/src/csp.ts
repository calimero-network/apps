/** The sources a CSP allows for `directive`, falling back to `default-src` as browsers do. */
export function cspSources(header: string, directive: string): string[] | null {
  const directives = new Map<string, string[]>();
  for (const part of header.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (!name) continue;
    const key = name.toLowerCase();
    // The first occurrence wins; browsers ignore repeats.
    if (!directives.has(key)) directives.set(key, values);
  }
  return directives.get(directive) ?? directives.get("default-src") ?? null;
}

/** An origin with no trailing slash, lowercased, for comparing with a CSP source. */
export function normalizeOrigin(url: string): string {
  return new URL(url).origin.toLowerCase();
}

/**
 * The `required` origins a CSP's `connect-src` does not let the page reach.
 * Only exact origins (and `*`) are honoured: wildcard hosts would also pass in
 * a browser, but a served page is never expected to carry one, and a smoke
 * that reported one as fine would hide a policy that changed shape.
 */
export function missingConnectSources(header: string, required: string[]): string[] {
  const sources = cspSources(header, "connect-src") ?? [];
  if (sources.includes("*")) return [];
  const allowed = new Set(
    sources
      .filter((s) => /^https?:\/\//i.test(s))
      .map((s) => {
        try {
          return normalizeOrigin(s);
        } catch {
          return s.toLowerCase();
        }
      }),
  );
  return [...new Set(required.map(normalizeOrigin))].filter((o) => !allowed.has(o));
}
