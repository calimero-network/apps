/**
 * Mero Docs - the hero animation: the app's own workspace, on Home.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * ⚠️ DRAWN FROM THE RUNNING APP. The workspace shell was booted with auth
 * injected and the node mocked, and screenshotted. Its own e2e suites are
 * `single-node` / `two-node` and need real merod, so the rail and Home are
 * reconstructed from their components, but the CHROME below is traced off
 * the real thing, and it corrected three guesses:
 *   • the shell is full-bleed. One bar across the top with a hairline under it
 *     and a hairline between rail and main, not floating rounded cards.
 *   • the top bar carries a sidebar toggle, the mark, the name, then the
 *     workspace switcher (name and an up/down chevron; New and Join live in
 *     its menu), the search field in the centre (`search/TopBarSearch.tsx`),
 *     and on the right the node dot, the node URL, a theme toggle and Log out.
 *   • the rail's sections each have a header row in small caps.
 *
 * The rest is component by component:
 *   • `workspace/SidebarNav.tsx`: Home with its count (selected), then Views
 *     and Tags, each row with a count on the right; a tag row leads with its dot.
 *   • `folders/FolderTree.tsx`: FOLDERS with a New button, colour swatches,
 *     and a LOCK on a restricted folder.
 *   • `home/HomeHeader.tsx`, `home/FilterBar.tsx`, `home/DocTable.tsx`: the
 *     title and count, New document, the filter chips and sort, then the list
 *     with Name, Folder, Tags and Updated, and "Bob is here" on a live row.
 *
 * COLOUR stays the page's tokens so the hero follows the page's theme toggle;
 * folder swatches and tag dots are the app's own fixed palette.
 *
 * Coordinates are literal pixels against a 495x341 box: see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

import { COLOR_PRESETS } from '@/constants/config';
import { TAG_COLORS, TAG_COLOR_NAMES, TAG_NEUTRAL } from '@/lib/tags';

/* ── Layout: the three-pane shell, full-bleed like the app ───────────── */
const L = 20;
const R = 475;
const BAR_TOP = 8;
const BAR_H = 26;
const BODY_TOP = BAR_TOP + BAR_H;
const BODY_BOTTOM = 306;
const RAIL_W = 136;
const MAIN_X = L + RAIL_W + 1;
const NAV_ROW_H = 16;
const LIST_TOP = BODY_TOP + 80;
const LIST_ROW_H = 22;
const COL_FOLDER = MAIN_X + 132; // Name | Folder | Tags | Updated, as DocTable
const COL_TAGS = MAIN_X + 204;
const SEARCH_X = L + 176; // the search field is centred in the gap between the switcher and the node URL
const SEARCH_W = 128;

const TXT = { fontFamily: 'var(--cal-lp-font)', lineHeight: 1 } as const;
const ROW = { display: 'flex', alignItems: 'center' } as const;

/* ── The lucide icons the app uses ───────────────────────────────────── */
const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;
const PanelLeft = () => (
  <svg viewBox="0 0 24 24" width="10" height="10" {...S}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);
const Sun = () => (
  <svg viewBox="0 0 24 24" width="10" height="10" {...S}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
const LogOut = () => (
  <svg viewBox="0 0 24 24" width="9" height="9" {...S}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);
const Plus = () => (
  <svg viewBox="0 0 24 24" width="8" height="8" {...S}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const Chevron = () => (
  <svg viewBox="0 0 24 24" width="8" height="8" {...S}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const FileIcon = ({ size = 10 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...S}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </svg>
);
const SearchIcon = () => (
  <svg viewBox="0 0 24 24" width="8" height="8" {...S}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="8" height="8" {...S}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const House = () => (
  <svg viewBox="0 0 24 24" width="10" height="10" {...S}>
    <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
    <path d="M3 10a2 2 0 0 1 .7-1.5l7-6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
);
const Bookmark = () => (
  <svg viewBox="0 0 24 24" width="9" height="9" {...S}>
    <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />
  </svg>
);
const SortIcon = () => (
  <svg viewBox="0 0 24 24" width="8" height="8" {...S}>
    <path d="m3 16 4 4 4-4M7 20V4M11 4h10M11 8h7M11 12h4" />
  </svg>
);

/* ── The data both panes show ────────────────────────────────────────── */
const tagHex = (name: (typeof TAG_COLOR_NAMES)[number]) =>
  TAG_COLORS[TAG_COLOR_NAMES.indexOf(name)];
const folderHex = (label: string) =>
  COLOR_PRESETS.find((c) => c.label === label)?.value ?? TAG_NEUTRAL;
const BLUE = folderHex('Blue');
const PURPLE = folderHex('Purple');
const GREEN = folderHex('Green');

const TAGS = [
  { name: 'roadmap', color: tagHex('Blue'), count: 3 },
  { name: 'design', color: tagHex('Purple'), count: 2 },
  { name: 'q3', color: tagHex('Slate'), count: 2 },
];
const FOLDERS = [
  { name: 'Product', color: BLUE },
  { name: 'Design', color: PURPLE, lock: true },
  { name: 'Engineering', color: GREEN, lock: true },
];
const DOCS: {
  title: string;
  folder: string;
  color: string;
  tags: string[];
  updated: string;
  live?: string;
}[] = [
  {
    title: 'Q3 roadmap',
    folder: 'Product',
    color: BLUE,
    tags: ['roadmap', 'q3'],
    updated: '2 min ago',
    live: 'Bob is here',
  },
  {
    title: 'API spec v2',
    folder: 'Engineering / Specs',
    color: GREEN,
    tags: ['design'],
    updated: '18 min ago',
  },
  {
    title: 'Brand guidelines',
    folder: 'Design',
    color: PURPLE,
    tags: ['design'],
    updated: '1 h ago',
  },
  {
    title: 'Launch plan',
    folder: 'Product',
    color: BLUE,
    tags: ['roadmap'],
    updated: 'Yesterday',
  },
  {
    title: 'Pricing notes',
    folder: 'Product',
    color: BLUE,
    tags: ['q3', 'roadmap'],
    updated: 'Sep 20',
  },
  {
    title: 'Incident runbook',
    folder: 'Engineering',
    color: GREEN,
    tags: [],
    updated: 'Sep 17',
  },
  {
    title: 'Hiring loop',
    folder: 'Design',
    color: PURPLE,
    tags: [],
    updated: 'Sep 12',
  },
];
const CHIPS = [
  { label: 'Folder', w: 34 },
  { label: 'Tag', w: 26 },
  { label: 'Updated', w: 40 },
  { label: 'Created by', w: 48 },
  { label: 'Archived', w: 40 },
];
const tagColor = (name: string) =>
  TAGS.find((t) => t.name === name)?.color ?? TAG_NEUTRAL;

/** A rail section header, as SidebarSectionHeader draws it. */
function RailHead({ label, top }: { label: string; top: number }) {
  return (
    <span
      className="cal-lp-a-txt cal-lp-a-txt--head"
      style={{ left: L + 10, top, fontSize: 6.5, letterSpacing: '0.08em' }}
    >
      {label}
    </span>
  );
}

/** A rail row: a lead (icon, dot or swatch), the name, and a count or a lock on the right. */
function RailRow({
  top,
  lead,
  name,
  count,
  lock,
  selected,
}: {
  top: number;
  lead: React.ReactNode;
  name: string;
  count?: number;
  lock?: boolean;
  selected?: boolean;
}) {
  return (
    <span>
      {selected && (
        <span
          className="cal-lp-a-box"
          style={{
            left: L + 6,
            top,
            width: RAIL_W - 12,
            height: NAV_ROW_H,
            borderRadius: 4,
            background: 'var(--cal-lp-accent-soft)',
            borderColor: 'transparent',
          }}
        />
      )}
      <span
        style={{
          ...ROW,
          ...TXT,
          position: 'absolute',
          left: L + 10,
          top: top + 4,
          width: RAIL_W - 20,
          gap: 5,
          fontSize: 8,
          fontWeight: selected ? 650 : 400,
          color: selected ? 'var(--cal-lp-accent-ink)' : 'var(--cal-lp-text)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            width: 10,
            justifyContent: 'center',
            color: 'var(--cal-lp-text-faint)',
          }}
        >
          {lead}
        </span>
        <span style={{ flex: 1 }}>{name}</span>
        {lock && (
          <span
            style={{
              display: 'inline-flex',
              color: 'var(--cal-lp-text-faint)',
            }}
          >
            <LockIcon />
          </span>
        )}
        {count !== undefined && (
          <span style={{ fontSize: 7, color: 'var(--cal-lp-text-faint)' }}>
            {count}
          </span>
        )}
      </span>
    </span>
  );
}

const Swatch = ({ color, size = 6 }: { color: string; size?: number }) => (
  <span
    style={{
      display: 'inline-block',
      width: size,
      height: size,
      borderRadius: 1.5,
      background: color,
    }}
  />
);
const Dot = ({ color }: { color: string }) => (
  <span
    style={{
      display: 'inline-block',
      width: 5,
      height: 5,
      borderRadius: '50%',
      background: color,
    }}
  />
);

export default function DriveAnimation() {
  const mainW = R - MAIN_X;
  const viewsTop = BODY_TOP + 6 + NAV_ROW_H + 8;
  const tagsTop = viewsTop + 14 + NAV_ROW_H + 8;
  const foldersTop = tagsTop + 14 + TAGS.length * NAV_ROW_H + 8;

  return (
    <div className="cal-lp-a" aria-hidden="true">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <span
        className="cal-lp-a-pane"
        style={{
          left: L,
          top: BAR_TOP,
          width: R - L,
          height: BAR_H,
          border: 'none',
          borderRadius: 0,
        }}
      />
      <span
        className="cal-lp-a-line"
        style={{ left: L, top: BAR_TOP + BAR_H, width: R - L, height: 1 }}
      />

      <span
        style={{
          position: 'absolute',
          left: L + 7,
          top: BAR_TOP + 8,
          color: 'var(--cal-lp-text-faint)',
        }}
      >
        <PanelLeft />
      </span>
      <span
        className="cal-lp-a-box"
        style={{
          left: L + 23,
          top: BAR_TOP + 8,
          width: 11,
          height: 11,
          borderRadius: 3,
          background: 'var(--cal-lp-accent)',
          borderColor: 'transparent',
        }}
      />
      <span
        className="cal-lp-a-txt cal-lp-a-txt--val"
        style={{
          left: L + 39,
          top: BAR_TOP + 10,
          fontSize: 8.5,
          fontWeight: 700,
        }}
      >
        Mero Docs
      </span>
      <span
        className="cal-lp-a-line"
        style={{ left: L + 92, top: BAR_TOP + 6, width: 1, height: 14 }}
      />

      {/* NamespaceSwitcher: a ghost button, the name and an up/down chevron. */}
      <span
        style={{
          ...ROW,
          ...TXT,
          position: 'absolute',
          left: L + 100,
          top: BAR_TOP + 9,
          gap: 4,
          fontSize: 7.5,
          color: 'var(--cal-lp-text)',
        }}
      >
        Product team
        <span style={{ fontSize: 7, color: 'var(--cal-lp-text-faint)' }}>
          ⇅
        </span>
      </span>

      {/* TopBarSearch: the field, its placeholder and the shortcut, centred. */}
      <span
        className="cal-lp-a-box"
        style={{
          ...ROW,
          ...TXT,
          left: SEARCH_X,
          top: BAR_TOP + 5,
          width: SEARCH_W,
          height: 16,
          gap: 4,
          padding: '0 3px 0 6px',
          fontSize: 6.5,
          color: 'var(--cal-lp-text-faint)',
        }}
      >
        <SearchIcon />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          Search docs, folders and #tags
        </span>
        <span
          style={{
            padding: '2px 3px',
            borderRadius: 3,
            border: '1px solid var(--cal-lp-border)',
            background: 'var(--cal-lp-bg-1)',
            fontSize: 5.5,
          }}
        >
          ⌘K
        </span>
      </span>

      <span
        className="cal-lp-a-dot"
        style={{
          left: R - 128,
          top: BAR_TOP + 11,
          width: 5,
          height: 5,
          background: 'var(--cal-lp-accent)',
        }}
      />
      <span
        className="cal-lp-a-txt cal-lp-a-txt--dim"
        style={{ left: R - 119, top: BAR_TOP + 10, fontSize: 7.5 }}
      >
        localhost:2428
      </span>
      <span
        style={{
          position: 'absolute',
          left: R - 56,
          top: BAR_TOP + 8,
          color: 'var(--cal-lp-text-faint)',
        }}
      >
        <Sun />
      </span>
      <span
        style={{
          ...ROW,
          ...TXT,
          position: 'absolute',
          left: R - 40,
          top: BAR_TOP + 9,
          gap: 3,
          fontSize: 7.5,
          color: 'var(--cal-lp-text-dim)',
        }}
      >
        <LogOut />
        Log out
      </span>

      {/* ── Left rail: Home, Views, Tags, then the folder tree ──────── */}
      <span
        className="cal-lp-a-line"
        style={{
          left: L + RAIL_W,
          top: BODY_TOP,
          width: 1,
          height: BODY_BOTTOM - BODY_TOP,
        }}
      />
      <RailRow
        top={BODY_TOP + 6}
        lead={<House />}
        name="Home"
        count={12}
        selected
      />

      <RailHead label="Views" top={viewsTop} />
      <RailRow
        top={viewsTop + 10}
        lead={<Bookmark />}
        name="Design this week"
        count={2}
      />

      <RailHead label="Tags" top={tagsTop} />
      {TAGS.map((t, i) => (
        <RailRow
          key={t.name}
          top={tagsTop + 10 + i * NAV_ROW_H}
          lead={<Dot color={t.color} />}
          name={t.name}
          count={t.count}
        />
      ))}

      <RailHead label="Folders" top={foldersTop} />
      <span
        style={{
          ...ROW,
          ...TXT,
          position: 'absolute',
          left: L + RAIL_W - 32,
          top: foldersTop - 1,
          gap: 2,
          fontSize: 7,
          color: 'var(--cal-lp-text-dim)',
        }}
      >
        <Plus />
        New
      </span>
      {FOLDERS.map((f, i) => (
        <RailRow
          key={f.name}
          top={foldersTop + 10 + i * NAV_ROW_H}
          lead={
            <span style={{ ...ROW, gap: 3 }}>
              <Chevron />
              <Swatch color={f.color} />
            </span>
          }
          name={f.name}
          lock={f.lock}
        />
      ))}

      {/* ── Main pane: Home ─────────────────────────────────────────── */}
      <span
        className="cal-lp-a-pane"
        style={{
          left: MAIN_X,
          top: BODY_TOP,
          width: mainW,
          height: BODY_BOTTOM - BODY_TOP,
          border: 'none',
          borderRadius: 0,
          background: 'var(--cal-lp-bg-1)',
        }}
      />
      <span
        className="cal-lp-a-txt cal-lp-a-txt--val"
        style={{
          left: MAIN_X + 14,
          top: BODY_TOP + 12,
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        Home
      </span>
      <span
        className="cal-lp-a-txt cal-lp-a-txt--dim"
        style={{ left: MAIN_X + 14, top: BODY_TOP + 28, fontSize: 7 }}
      >
        12 documents across 4 folders
      </span>
      {/* New document: the primary button, a lime fill. */}
      <span
        style={{
          ...ROW,
          ...TXT,
          position: 'absolute',
          left: R - 74,
          top: BODY_TOP + 12,
          height: 15,
          padding: '0 6px',
          gap: 3,
          borderRadius: 4,
          fontSize: 6.5,
          fontWeight: 650,
          background: 'var(--cal-lp-accent)',
          color: 'var(--cal-lp-accent-text)',
        }}
      >
        <Plus />
        New document
      </span>

      {/* FilterBar: the chips, then the sort on the right. */}
      {CHIPS.map((c, i) => {
        const left =
          MAIN_X + 14 + CHIPS.slice(0, i).reduce((x, p) => x + p.w + 4, 0);
        return (
          <span
            key={c.label}
            className="cal-lp-a-box"
            style={{
              ...ROW,
              ...TXT,
              left,
              top: BODY_TOP + 42,
              width: c.w,
              height: 12,
              justifyContent: 'center',
              borderRadius: 999,
              fontSize: 6,
              color: 'var(--cal-lp-text-dim)',
              background: 'var(--cal-lp-bg-1)',
            }}
          >
            {c.label}
          </span>
        );
      })}
      <span
        style={{
          ...ROW,
          ...TXT,
          position: 'absolute',
          right: 34,
          top: BODY_TOP + 45,
          gap: 3,
          fontSize: 6.5,
          color: 'var(--cal-lp-text-dim)',
        }}
      >
        <SortIcon />
        Last updated
      </span>
      <span
        className="cal-lp-a-line"
        style={{ left: MAIN_X, top: BODY_TOP + 62, width: mainW, height: 1 }}
      />

      {/* DocTable: the header row, then one row per doc, newest first. */}
      {[
        ['Name', MAIN_X + 14],
        ['Folder', COL_FOLDER],
        ['Tags', COL_TAGS],
      ].map(([label, left]) => (
        <span
          key={label}
          className="cal-lp-a-txt cal-lp-a-txt--head"
          style={{ left, top: BODY_TOP + 68, fontSize: 5.5 }}
        >
          {label}
        </span>
      ))}
      <span
        className="cal-lp-a-txt cal-lp-a-txt--head"
        style={{ right: 34, top: BODY_TOP + 68, fontSize: 5.5 }}
      >
        Updated
      </span>
      {DOCS.map((d, i) => {
        const top = LIST_TOP + i * LIST_ROW_H;
        return (
          // The newest row fades in: a peer's new doc arriving live.
          <span
            key={d.title}
            className={i === 0 ? 'cal-lp-a-in' : undefined}
            style={{ ['--t' as string]: '6s' }}
          >
            <span
              className="cal-lp-a-line"
              style={{
                left: MAIN_X + 8,
                top: top - 2,
                width: mainW - 16,
                height: 1,
              }}
            />
            <span
              style={{
                ...ROW,
                ...TXT,
                position: 'absolute',
                left: MAIN_X + 14,
                top: top + 6,
                gap: 4,
                fontSize: 7.5,
                fontWeight: 600,
                color: 'var(--cal-lp-text)',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  color: 'var(--cal-lp-text-faint)',
                }}
              >
                <FileIcon size={8} />
              </span>
              {d.title}
              {d.live && (
                <span
                  className="cal-lp-a-blink"
                  style={{
                    ...ROW,
                    gap: 2,
                    fontSize: 5.5,
                    fontWeight: 650,
                    color: 'var(--cal-lp-accent-ink)',
                    ['--t' as string]: '3s',
                  }}
                >
                  <Dot color="var(--cal-lp-accent)" />
                  {d.live}
                </span>
              )}
            </span>
            <span
              style={{
                ...ROW,
                ...TXT,
                position: 'absolute',
                left: COL_FOLDER,
                top: top + 6,
                gap: 3,
                fontSize: 6.5,
                color: 'var(--cal-lp-text-dim)',
              }}
            >
              <Swatch color={d.color} size={5} />
              {d.folder}
            </span>
            <span
              style={{
                ...ROW,
                ...TXT,
                position: 'absolute',
                left: COL_TAGS,
                top: top + 4,
                gap: 2,
              }}
            >
              {d.tags.map((t) => (
                <span
                  key={t}
                  style={{
                    ...ROW,
                    gap: 2,
                    padding: '1.5px 3px',
                    borderRadius: 3,
                    fontSize: 5.5,
                    color: 'var(--cal-lp-text-dim)',
                    background: 'var(--cal-lp-bg-3)',
                  }}
                >
                  <Dot color={tagColor(t)} />
                  {t}
                </span>
              ))}
            </span>
            <span
              className="cal-lp-a-txt cal-lp-a-txt--dim"
              style={{ right: 34, top: top + 6, fontSize: 6.5 }}
            >
              {d.updated}
            </span>
          </span>
        );
      })}

      <span
        className="cal-lp-a-txt cal-lp-a-txt--dim"
        style={{ left: 20, bottom: 3, fontSize: 8.5 }}
      >
        Home lists every document you can open, in every folder. A lock means a
        folder replicates only to its members.
      </span>
    </div>
  );
}
