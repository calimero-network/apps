import { Download, HeartCheck, Trash } from '@calimero-network/mero-icons';

import {
  ActivityIcon,
  GridIcon,
  TagIcon,
  UsersIcon,
} from '../../components/icons';
import { CATEGORIES } from '../../lib/itemView';
import { KindIcon } from './ItemList';
import styles from './items.module.css';

/**
 * What the middle and right columns show. `all`, a kind, or a tag filters the
 * item list; the rest are the vault's tools, which take both columns.
 */
export type View =
  | { type: 'all' }
  | { type: 'kind'; kind: string }
  | { type: 'tag'; tag: string }
  | { type: 'tool'; tool: Tool };

export type Tool = 'health' | 'trash' | 'people' | 'activity' | 'transfer';

function sameView(a: View, b: View): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'kind') return a.kind === (b as typeof a).kind;
  if (a.type === 'tag') return a.tag === (b as typeof a).tag;
  if (a.type === 'tool') return a.tool === (b as typeof a).tool;
  return true;
}

function Item({
  active,
  icon,
  name,
  count,
  alert,
  onClick,
  testId,
}: {
  active: boolean;
  icon: React.ReactNode;
  name: string;
  count?: number;
  alert?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={`${styles.sideItem} ${active ? styles.sideActive : ''}`}
      onClick={onClick}
      aria-current={active}
      data-testid={testId}
    >
      <span className={styles.sideIcon}>{icon}</span>
      <span className={styles.sideName}>{name}</span>
      {count !== undefined && count > 0 && (
        <span
          className={`${styles.sideCount} ${alert ? styles.sideAlert : ''}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default function VaultSidebar({
  view,
  onView,
  counts,
  tags,
  trashed,
  flagged,
  personal,
}: {
  view: View;
  onView: (v: View) => void;
  /** Live items per kind; `all` is the total. */
  counts: Record<string, number>;
  tags: string[];
  trashed: number;
  /** Items the health check flags. */
  flagged: number;
  personal: boolean;
}) {
  const is = (v: View) => sameView(view, v);
  return (
    <nav className={styles.side} aria-label="Vault sections">
      <p className={styles.sideLabel}>Items</p>
      <Item
        active={is({ type: 'all' })}
        icon={<GridIcon size={16} />}
        name="All items"
        count={counts.all}
        onClick={() => onView({ type: 'all' })}
        testId="tab-secrets"
      />
      {CATEGORIES.filter((c) => (counts[c.id] ?? 0) > 0).map((c) => (
        <Item
          key={c.id}
          active={is({ type: 'kind', kind: c.id })}
          icon={<KindIcon kind={c.id} size={16} />}
          name={c.label}
          count={counts[c.id]}
          onClick={() => onView({ type: 'kind', kind: c.id })}
          testId={`category-${c.id}`}
        />
      ))}

      {tags.length > 0 && <p className={styles.sideLabel}>Tags</p>}
      {tags.map((t) => (
        <Item
          key={t}
          active={is({ type: 'tag', tag: t })}
          icon={<TagIcon size={16} />}
          name={t}
          onClick={() => onView({ type: 'tag', tag: t })}
        />
      ))}

      <p className={styles.sideLabel}>Vault</p>
      <Item
        active={is({ type: 'tool', tool: 'health' })}
        icon={<HeartCheck size={16} />}
        name="Password health"
        count={flagged}
        alert
        onClick={() => onView({ type: 'tool', tool: 'health' })}
        testId="tab-health"
      />
      {!personal && (
        <Item
          active={is({ type: 'tool', tool: 'people' })}
          icon={<UsersIcon size={16} />}
          name="People & devices"
          onClick={() => onView({ type: 'tool', tool: 'people' })}
          testId="tab-people"
        />
      )}
      <Item
        active={is({ type: 'tool', tool: 'activity' })}
        icon={<ActivityIcon size={16} />}
        name="Activity"
        onClick={() => onView({ type: 'tool', tool: 'activity' })}
        testId="tab-activity"
      />
      <Item
        active={is({ type: 'tool', tool: 'transfer' })}
        icon={<Download size={16} />}
        name="Import & export"
        onClick={() => onView({ type: 'tool', tool: 'transfer' })}
        testId="tab-transfer"
      />
      <Item
        active={is({ type: 'tool', tool: 'trash' })}
        icon={<Trash size={16} />}
        name="Trash"
        count={trashed}
        onClick={() => onView({ type: 'tool', tool: 'trash' })}
        testId="tab-trash"
      />
    </nav>
  );
}
