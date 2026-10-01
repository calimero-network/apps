import { useEffect, useState } from 'react';
import { Eye, EyeOff } from '@calimero-network/mero-icons';

import TotpCode from '../../components/TotpCode';
import { BackIcon, CopyIcon, OpenIcon } from '../../components/icons';
import { strengthOf } from '../../lib/health';
import { asDate, kindLabel, openableUrl, who } from '../../lib/itemView';
import {
  FIELDS,
  type Kind,
  isSensitive,
  isTotpField,
} from '../../lib/secretKinds';
import type { Revision, Secret } from '../../lib/vaultSession';
import shell from '../../styles/shell.module.css';
import { ItemTile } from './ItemList';
import styles from './items.module.css';

const STRENGTH = [
  ['Very weak', 'var(--danger)'],
  ['Weak', 'var(--danger)'],
  ['Fair', 'var(--warning)'],
  ['Strong', 'var(--success)'],
  ['Very strong', 'var(--success)'],
] as const;

/** The kind's own labels, in the kind's own order, then anything extra. */
function orderedFields(s: Secret): [string, string, string][] {
  const spec = FIELDS[s.kind as Kind] ?? [];
  const known = spec
    .filter((f) => (s.fields[f.key] ?? '') !== '')
    .map((f) => [f.key, f.label, s.fields[f.key]!] as [string, string, string]);
  const extra = Object.entries(s.fields)
    .filter(([k, v]) => v !== '' && !spec.some((f) => f.key === k))
    .map(([k, v]) => [k, k.replace(/_/g, ' '), v] as [string, string, string]);
  return [...known, ...extra];
}

function isMultiline(kind: string, key: string): boolean {
  return !!FIELDS[kind as Kind]?.find((f) => f.key === key)?.multiline;
}

/**
 * The item on the right: every field as a row you can copy with one click,
 * secrets concealed until revealed, and the item's actions at the top.
 *
 * A concealed value renders a fixed run of dots, not the value under a mask:
 * a mask leaves the characters in the DOM for anything that reads the page.
 */
export default function ItemDetail({
  secret,
  me,
  canWrite,
  onBack,
  onCopy,
  onEdit,
  onShare,
  onTrash,
  loadHistory,
  onRestore,
}: {
  secret: Secret;
  me?: string;
  canWrite: boolean;
  onBack: () => void;
  onCopy: (value: string, what: string) => void;
  onEdit: () => void;
  onShare: () => void;
  onTrash: () => void;
  loadHistory: () => Promise<Revision[]>;
  onRestore: (r: Revision) => void;
}) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<Revision[] | null>(null);

  // A different item starts concealed, with its history closed.
  useEffect(() => {
    setRevealed(new Set());
    setHistory(null);
  }, [secret.id]);

  const toggle = (key: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className={styles.detail} data-testid="item-detail">
      <button
        type="button"
        className={`${shell.btnGhost} ${styles.back}`}
        onClick={onBack}
      >
        <BackIcon size={14} /> All items
      </button>

      <div className={styles.detailHead}>
        <ItemTile secret={secret} large />
        <div className={styles.detailTitle}>
          <h2 className={styles.detailName} data-testid="item-name">
            {secret.name}
          </h2>
          <p className={styles.detailKind}>{kindLabel(secret.kind)}</p>
        </div>
        <div className={styles.detailActions}>
          {canWrite && !secret.unreadable && (
            <button
              type="button"
              className={shell.btn}
              onClick={onEdit}
              data-testid="secret-edit"
            >
              Edit
            </button>
          )}
          {!secret.unreadable && (
            <button
              type="button"
              className={shell.btnGhost}
              onClick={onShare}
              data-testid="secret-share"
            >
              Share
            </button>
          )}
        </div>
      </div>

      {secret.unreadable && (
        <p className={shell.notice}>
          Part of this item is sealed under a key this device never received.
        </p>
      )}

      <div className={styles.fields}>
        {orderedFields(secret).map(([key, label, value]) => {
          const sensitive = isSensitive(secret.kind, key);
          const totp = isTotpField(secret.kind, key);
          const shown = !sensitive || revealed.has(key);
          const url = key === 'url' ? openableUrl(value) : null;
          const multi = isMultiline(secret.kind, key);
          const strength =
            key === 'password' && shown ? STRENGTH[strengthOf(value)] : null;
          return (
            <div key={key} className={styles.field} data-testid="field">
              <div className={styles.fieldText}>
                <span className={styles.fieldLabel}>
                  {totp ? 'One-time code' : label}
                </span>
                {totp ? (
                  <TotpCode seed={value} />
                ) : (
                  <span
                    className={`${styles.fieldValue} ${multi ? styles.fieldMulti : ''} ${sensitive ? styles.fieldMono : ''} ${shown ? '' : styles.fieldMasked}`}
                    data-testid={shown ? 'field-shown' : 'field-hidden'}
                  >
                    {shown ? value : '••••••••••••'}
                  </span>
                )}
                {strength && (
                  <span className={styles.meter}>
                    <span className={styles.meterBar}>
                      <span
                        className={styles.meterFill}
                        style={{
                          width: `${((strengthOf(value) + 1) / 5) * 100}%`,
                          background: strength[1],
                        }}
                      />
                    </span>
                    {strength[0]}
                  </span>
                )}
              </div>
              {!totp && (
                <div className={styles.fieldActions}>
                  {sensitive && (
                    <button
                      type="button"
                      className={styles.icon}
                      onClick={() => toggle(key)}
                      aria-label={shown ? `Hide ${label}` : `Reveal ${label}`}
                      title={shown ? 'Hide' : 'Reveal'}
                      data-testid="reveal"
                    >
                      {shown ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  )}
                  {url && (
                    <a
                      className={styles.icon}
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label="Open website"
                      title="Open website"
                    >
                      <OpenIcon size={16} />
                    </a>
                  )}
                  <button
                    type="button"
                    className={styles.icon}
                    onClick={() => onCopy(value, label)}
                    aria-label={`Copy ${label}`}
                    title="Copy"
                    data-testid={`copy-${key}`}
                  >
                    <CopyIcon size={16} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {secret.tags.length > 0 && (
        <div className={styles.tagRow}>
          {secret.tags.map((t) => (
            <span key={t} className={shell.badge}>
              {t}
            </span>
          ))}
        </div>
      )}

      <div className={styles.meta}>
        Modified {asDate(secret.updatedAt).toLocaleString()} by{' '}
        {who(secret.updatedBy, me)}
        <br />
        Created {asDate(secret.createdAt).toLocaleString()} by{' '}
        {who(secret.createdBy, me)}
      </div>

      <div className={styles.detailActions} style={{ marginTop: '1.25rem' }}>
        <button
          type="button"
          className={shell.btnGhost}
          onClick={async () => setHistory(history ? null : await loadHistory())}
          data-testid="secret-history-toggle"
        >
          {history ? 'Hide history' : 'Previous values'}
        </button>
        {canWrite && (
          <button
            type="button"
            className={shell.btnDanger}
            onClick={onTrash}
            data-testid="secret-trash"
          >
            Move to trash
          </button>
        )}
      </div>

      {history && (
        <>
          <h3 className={styles.sectionTitle}>Previous values</h3>
          <div className={styles.fields} data-testid="secret-history">
            {history.length === 0 ? (
              <div className={styles.historyRow}>No earlier values.</div>
            ) : (
              history.map((r, i) => (
                <div key={i} className={styles.historyRow}>
                  <span className={styles.historyMeta}>
                    {r.field.replace(/_/g, ' ')} ·{' '}
                    {asDate(r.replacedAt).toLocaleString()} ·{' '}
                    {who(r.replacedBy, me)}
                  </span>
                  <span className={styles.fieldMono}>
                    {r.unreadable
                      ? 'sealed under a key this device never had'
                      : isSensitive(secret.kind, r.field)
                        ? '••••••••'
                        : r.previous}
                  </span>
                  {!r.unreadable && canWrite && (
                    <button
                      type="button"
                      className={shell.btnGhost}
                      onClick={() => onRestore(r)}
                    >
                      Restore
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
