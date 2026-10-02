function sectionBounds(lines: string[], section: string): [number, number] | null {
  const start = lines.findIndex((l) => l.trim() === `[${section}]`);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  return [start, end];
}

function renderValue(value: string | number | boolean | string[]): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : `[\n${value.map((v) => `    ${JSON.stringify(v)},`).join("\n")}\n]`;
  }
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

export function setTomlKey(
  source: string,
  section: string,
  key: string,
  value: string | number | boolean | string[],
): string {
  const lines = source.split("\n");
  const rendered = `${key} = ${renderValue(value)}`;
  const bounds = sectionBounds(lines, section);
  if (!bounds) {
    return `${source.replace(/\n*$/, "")}\n\n[${section}]\n${rendered}\n`;
  }
  const [start, end] = bounds;
  const keyPattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
  for (let i = start + 1; i < end; i++) {
    if (!keyPattern.test(lines[i] ?? "")) continue;
    let last = i;
    const opensArray = /=\s*\[/.test(lines[i] ?? "") && !/\]\s*$/.test((lines[i] ?? "").trim());
    if (opensArray) {
      while (last < end && !/^\s*\]/.test(lines[last] ?? "")) last++;
    }
    lines.splice(i, last - i + 1, rendered);
    return lines.join("\n");
  }
  lines.splice(start + 1, 0, rendered);
  return lines.join("\n");
}

export function readTomlString(source: string, section: string, key: string): string | undefined {
  const lines = source.split("\n");
  const bounds = sectionBounds(lines, section);
  if (!bounds) return undefined;
  for (let i = bounds[0] + 1; i < bounds[1]; i++) {
    const m = (lines[i] ?? "").match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`));
    if (m) return m[1];
  }
  return undefined;
}
