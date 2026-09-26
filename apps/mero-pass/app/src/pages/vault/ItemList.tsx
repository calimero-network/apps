import { forwardRef } from 'react';
import {
  Clock,
  FileText,
  Lock,
  LockBox,
  LockStar,
  ShieldCheck,
} from '@calimero-network/mero-icons';

import { CopyIcon, SearchIcon } from '../../components/icons';
import { monogramOf, subtitleOf } from '../../lib/itemView';
import type { Secret } from '../../lib/vaultSession';
import styles from './items.module.css';

/**
 * Line icons from the Calimero set, one per kind. Not emoji: an emoji is a
 * fixed-colour bitmap that cannot follow the theme.
 */
const KIND_ICON: Record<string, typeof Lock> = {
  login: Lock,
  secure_note: FileText,
  totp: Clock,
  ssh_key: LockStar,
  payment_card: LockBox,
  identity: ShieldCheck,
};

export function KindIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const Icon = KIND_ICON[kind] ?? Lock;
  return <Icon size={size} />;
}

/**
 * A login shows the first letter of its name, as a password manager's tile
 * does; every other kind shows its icon. No site favicons: fetching one would
 * tell a third party which sites are in the vault.
 */
export function ItemTile({
  secret,
  large,
}: {
  secret: Secret;
  large?: boolean;
}) {
  const cls = `${styles.tile} ${large ? styles.tileLarge : ''}`;
  if (secret.kind === 'login')
    return (
      <span className={cls} aria-hidden="true">
        {monogramOf(secret.name)}
      </span>
    );
  return (
    <span className={`${cls} ${styles.tileKind}`} aria-hidden="true">
      <KindIcon kind={secret.kind} size={large ? 24 : 16} />
    </span>
  );
}

export const SearchBox = forwardRef<
  HTMLInputElement,
  { value: string; onChange: (v: string) => void; placeholder: string }
>(function SearchBox({ value, onChange, placeholder }, ref) {
  return (
    <label className={styles.search}>
      <SearchIcon size={16} />
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChange('');
        }}
        aria-label="Search this vault"
        data-testid="secret-search"
      />
      {!value && (
        <kbd className={styles.kbd} aria-hidden="true">
          /
        </kbd>
      )}
    </label>
  );
});

/** The field a list row's quick-copy button takes, by kind. */
function quickCopy(s: Secret): [string, string] | null {
  if (s.unreadable) return null;
  if (s.kind === 'login' && s.fields.password) return ['password', 'Password'];
  if (s.kind === 'payment_card' && s.fields.card_number)
    return ['card_number', 'Card number'];
  return null;
}

/**
 * The middle column. Arrow keys move the selection; the row's copy button
 * takes the password (or card number) without opening the item.
 */
export default function ItemList({
  heading,
  items,
  selected,
  onSelect,
  onCopy,
  empty,
}: {
  heading: string;
  items: Secret[];
  selected: string | null;
  onSelect: (id: string) => void;
  onCopy: (value: string, what: string) => void;
  empty: React.ReactNode;
}) {
  const move = (e: React.KeyboardEvent, index: number) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = items[index + step];
    if (!next) return;
    onSelect(next.id);
    const row = (e.currentTarget.parentElement?.children[index + step] ??
      null) as HTMLElement | null;
    row?.focus();
  };

  return (
    <>
      <div className={styles.listHead}>
        {heading} · {items.length}
      </div>
      {items.length === 0 ? (
        <div className={styles.listEmpty} data-testid="secrets-empty">
          {empty}
        </div>
      ) : (
        <div data-testid="secret-list">
          {items.map((s, i) => {
            const copy = quickCopy(s);
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                className={`${styles.row} ${s.id === selected ? styles.rowActive : ''}`}
                onClick={() => onSelect(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(s.id);
                  } else move(e, i);
                }}
                aria-current={s.id === selected}
                data-testid="secret-row"
              >
                <ItemTile secret={s} />
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{s.name}</span>
                  <span className={styles.rowSub}>
                    {s.unreadable
                      ? 'Not readable on this device'
                      : subtitleOf(s)}
                  </span>
                </span>
                {copy && (
                  <span className={styles.rowCopy}>
                    <button
                      type="button"
                      className={styles.icon}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCopy(s.fields[copy[0]]!, copy[1]);
                      }}
                      aria-label={`Copy ${copy[1]} of ${s.name}`}
                      title={`Copy ${copy[1].toLowerCase()}`}
                    >
                      <CopyIcon size={15} />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
