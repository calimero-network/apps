import { useEffect, useRef, useState } from "react";

import { useAudience } from "../components/AudienceShell";
import { CategoryChip } from "../components/bits";
import type { CategoryView } from "../generated/UpdatesClient";
import { CATEGORY_COLORS, useLive, useUpdatesClient } from "../lib/updates";

/** One click to a sensible taxonomy; every one of them editable after. */
const STARTER_CATEGORIES = [
  { name: "Monthly update", emoji: "📅", color: "#2563eb" },
  { name: "Fundraising", emoji: "💰", color: "#16a34a" },
  { name: "Product", emoji: "🚀", color: "#7c3aed" },
  { name: "Hiring", emoji: "🧑‍💻", color: "#d97706" },
  { name: "Board", emoji: "🏛️", color: "#525252" },
];

const CADENCES = [
  { days: 0, label: "No reminder" },
  { days: 7, label: "Weekly" },
  { days: 14, label: "Every two weeks" },
  { days: 30, label: "Monthly" },
  { days: 91, label: "Quarterly" },
];

/**
 * Team-only: the company's name, how often it means to write, and the
 * categories updates are filed under.
 */
export default function SettingsPage() {
  const client = useUpdatesClient();
  const { me, categories, reload } = useAudience();
  const settings = useLive((c) => c.getSettings(), []);
  const [company, setCompany] = useState("");
  const [cadence, setCadence] = useState(30);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the form ONCE, from the first answer. Re-seeding on every re-read
  // (and every contract event re-reads) overwrote what was being typed — and
  // a load landing after the first keystroke saved an empty name.
  const seeded = useRef(false);
  useEffect(() => {
    if (!settings.data || seeded.current) return;
    seeded.current = true;
    setCompany((typed) => typed || settings.data!.company_name);
    setCadence(settings.data.updated_at ? settings.data.cadence_days : 30);
  }, [settings.data]);

  if (me && !me.is_team) return <div className="notice">Only the company team can change settings.</div>;

  const saveSettings = async () => {
    if (!client) return;
    setError(null);
    try {
      await client.setSettings({ company_name: company.trim(), cadence_days: cadence });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addStarters = async () => {
    if (!client) return;
    for (const c of STARTER_CATEGORIES) {
      if (categories.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) continue;
      await client.createCategory(c);
    }
    reload();
  };

  return (
    <>
      <section className="card form" data-testid="settings">
        <h2 className="sectionLabel">Company</h2>
        <label className="fieldLabel" htmlFor="company">
          Company name
        </label>
        <input id="company" value={company} maxLength={64} placeholder="Acme Inc." onChange={(e) => setCompany(e.target.value)} />
        <label className="fieldLabel" htmlFor="cadence">
          Update cadence
        </label>
        <select id="cadence" value={cadence} onChange={(e) => setCadence(Number(e.target.value))}>
          {CADENCES.map((c) => (
            <option key={c.days} value={c.days}>
              {c.label}
            </option>
          ))}
        </select>
        <p className="muted small">
          Drives the “next update due” reminder on the team's home screen. Regular beats long: investors trust the
          founder who writes every month, good news or not.
        </p>
        <div className="row end">
          {error && <span className="errorText">{error}</span>}
          {saved && <span className="okText">Saved</span>}
          <button className="primary small" onClick={() => void saveSettings()}>
            Save
          </button>
        </div>
      </section>

      <section className="card form">
        <h2 className="sectionLabel">Categories</h2>
        <p className="muted small">
          File every update under one. Investors filter by category and can mute the ones they don't need.
        </p>
        {categories.map((c) => (
          <CategoryEditor key={c.id} category={c} onChanged={reload} />
        ))}
        <NewCategory onCreated={reload} />
        {categories.length === 0 && (
          <button className="ghost small" onClick={() => void addStarters()} data-testid="starter-categories">
            + Add starter set (Monthly, Fundraising, Product, Hiring, Board)
          </button>
        )}
      </section>
    </>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Colour">
      {CATEGORY_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          className="swatch"
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

function NewCategory({ onCreated }: { onCreated: () => void }) {
  const client = useUpdatesClient();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [color, setColor] = useState(CATEGORY_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    if (!client || !name.trim()) return;
    setError(null);
    try {
      await client.createCategory({ name: name.trim(), emoji: emoji.trim(), color });
      setName("");
      setEmoji("");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="categoryEditor">
      <div className="row">
        <input className="emojiInput" aria-label="Emoji" placeholder="🙂" value={emoji} maxLength={8} onChange={(e) => setEmoji(e.target.value)} />
        <input
          aria-label="New category name"
          placeholder="New category…"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void create()}
        />
        <button className="primary small" disabled={!name.trim()} onClick={() => void create()} data-testid="add-category">
          Add
        </button>
      </div>
      <ColorPicker value={color} onChange={setColor} />
      {error && <span className="errorText">{error}</span>}
    </div>
  );
}

function CategoryEditor({ category, onChanged }: { category: CategoryView; onChanged: () => void }) {
  const client = useUpdatesClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [emoji, setEmoji] = useState(category.emoji);
  const [color, setColor] = useState(category.color);
  const [confirm, setConfirm] = useState(false);

  if (!editing)
    return (
      <div className="row categoryRow">
        <CategoryChip category={category} />
        <span className="muted small">
          {category.update_count} update{category.update_count === 1 ? "" : "s"}
        </span>
        <div className="grow" />
        <button className="linkBtn" onClick={() => setEditing(true)}>
          Edit
        </button>
        {confirm ? (
          <>
            <span className="muted small">Archive? Existing updates keep the label.</span>
            <button
              className="linkBtn danger"
              onClick={async () => {
                await client?.archiveCategory({ category_id: category.id });
                onChanged();
              }}
            >
              Archive
            </button>
            <button className="linkBtn" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="linkBtn danger" onClick={() => setConfirm(true)}>
            Archive
          </button>
        )}
      </div>
    );

  return (
    <div className="categoryEditor">
      <div className="row">
        <input className="emojiInput" aria-label="Emoji" value={emoji} maxLength={8} onChange={(e) => setEmoji(e.target.value)} />
        <input aria-label="Category name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <button
          className="primary small"
          disabled={!name.trim()}
          onClick={async () => {
            await client?.editCategory({ category_id: category.id, name: name.trim(), emoji: emoji.trim(), color });
            setEditing(false);
            onChanged();
          }}
        >
          Save
        </button>
        <button className="ghost small" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      <ColorPicker value={color} onChange={setColor} />
    </div>
  );
}
