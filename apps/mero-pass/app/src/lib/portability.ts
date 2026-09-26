// ── Getting secrets in and out ──────────────────────────────────────────────
//
// Import reads the CSV exports of Bitwarden, 1Password and Chrome/Edge (which
// share a format with most Chromium browsers) and turns each row into a draft.
// Nothing is sent anywhere until the drafts are added — and then they are
// sealed like any other secret.
//
// Export is ENCRYPTED only: a passphrase-sealed JSON file. A plaintext export
// of a password manager is a file that outlives every access control this app
// has, so it is not offered.

import { fromB64, randomBytes, toB64 } from './crypto';
import type { Secret, SecretDraft } from './vaultSession';

// ── CSV ──────────────────────────────────────────────────────────────────────

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

export type ImportSource = 'bitwarden' | '1password' | 'chrome' | 'unknown';

export function detectSource(header: string[]): ImportSource {
  const h = new Set(header.map((c) => c.trim().toLowerCase()));
  if (h.has('login_password') && h.has('login_uri')) return 'bitwarden';
  if (h.has('title') && h.has('password')) return '1password';
  if (h.has('name') && h.has('url') && h.has('password')) return 'chrome';
  return 'unknown';
}

function pick(row: Record<string, string>, ...names: string[]): string {
  for (const n of names) {
    const v = row[n];
    if (v !== undefined && v.trim() !== '') return v.trim();
  }
  return '';
}

/**
 * Turn an export into drafts. Rows with neither a name nor a password are
 * skipped; a row carrying an authenticator seed keeps it in `totp`.
 */
export function importCsv(text: string): {
  source: ImportSource;
  drafts: SecretDraft[];
} {
  const rows = parseCsv(text);
  if (rows.length === 0) return { source: 'unknown', drafts: [] };
  const header = rows[0].map((c) => c.trim().toLowerCase());
  const source = detectSource(header);
  const drafts: SecretDraft[] = [];
  for (const cells of rows.slice(1)) {
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ''));
    if (
      source === 'bitwarden' &&
      row.type &&
      row.type !== 'login' &&
      row.type !== 'note'
    ) {
      continue;
    }
    const name =
      pick(row, 'name', 'title') ||
      pick(row, 'login_uri', 'url') ||
      'Imported item';
    const notes = pick(row, 'notes', 'note');
    if (source === 'bitwarden' && row.type === 'note') {
      drafts.push({
        kind: 'secure_note',
        name,
        tags: tagsFrom(row),
        fields: { notes },
      });
      continue;
    }
    const password = pick(row, 'login_password', 'password');
    const username = pick(row, 'login_username', 'username');
    if (!password && !username && !notes) continue;
    const fields: Record<string, string> = {
      username,
      password,
      url: pick(row, 'login_uri', 'url'),
      totp: pick(row, 'login_totp', 'otpauth'),
      notes,
    };
    for (const k of Object.keys(fields)) if (!fields[k]) delete fields[k];
    drafts.push({ kind: 'login', name, tags: tagsFrom(row), fields });
  }
  return { source, drafts };
}

function tagsFrom(row: Record<string, string>): string[] {
  const folder = pick(row, 'folder', 'tags');
  return folder
    ? folder
        .split(/[,;/]/)
        .map((t) => t.trim())
        .filter(Boolean)
    : ['imported'];
}

// ── Encrypted export ─────────────────────────────────────────────────────────

const EXPORT_ITERATIONS = 600_000;

interface ExportFile {
  format: 'mero-pass-export';
  v: 1;
  kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string };
  iv: string;
  ct: string;
}

async function exportKey(pass: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pass),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptExport(
  secrets: Secret[],
  passphrase: string,
): Promise<string> {
  if (passphrase.length < 8)
    throw new Error('Use a passphrase of at least 8 characters.');
  const drafts: SecretDraft[] = secrets
    .filter((s) => !s.unreadable)
    .map((s) => ({
      kind: s.kind,
      name: s.name,
      tags: s.tags,
      fields: s.fields,
    }));
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      await exportKey(passphrase, salt, EXPORT_ITERATIONS),
      new TextEncoder().encode(JSON.stringify(drafts)),
    ),
  );
  const file: ExportFile = {
    format: 'mero-pass-export',
    v: 1,
    kdf: {
      name: 'PBKDF2-SHA256',
      iterations: EXPORT_ITERATIONS,
      salt: toB64(salt),
    },
    iv: toB64(iv),
    ct: toB64(ct),
  };
  return JSON.stringify(file, null, 2);
}

export async function decryptExport(
  text: string,
  passphrase: string,
): Promise<SecretDraft[]> {
  let file: ExportFile;
  try {
    file = JSON.parse(text) as ExportFile;
  } catch {
    throw new Error('This is not a Mero Pass export.');
  }
  if (file.format !== 'mero-pass-export' || file.v !== 1) {
    throw new Error('This is not a Mero Pass export.');
  }
  try {
    const key = await exportKey(
      passphrase,
      fromB64(file.kdf.salt),
      file.kdf.iterations,
    );
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(fromB64(file.iv)) },
      key,
      new Uint8Array(fromB64(file.ct)),
    );
    return JSON.parse(new TextDecoder().decode(pt)) as SecretDraft[];
  } catch {
    throw new Error('Wrong passphrase, or the file is damaged.');
  }
}
