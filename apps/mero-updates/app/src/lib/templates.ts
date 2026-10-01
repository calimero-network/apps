import type {
  ContributionView,
  MetricSeries,
  PostView,
  UpdateInput,
} from "../generated/UpdatesClient";
import { askKind, personLabel } from "./updates";

/**
 * The composer's working state. This is what a DRAFT stores (as JSON, in the
 * contract's node-local private storage) and what `toInput` turns into the
 * contract's `UpdateInput` on publish.
 *
 * Kept separate from `UpdateInput` because a draft is allowed to be
 * incomplete — an empty metric row, a section heading with no body yet — and
 * publishing is where that gets cleaned up.
 */
export interface ComposerState {
  title: string;
  summary: string;
  categoryId: string;
  sections: { kind: string; title: string; body: string }[];
  metrics: { name: string; value: string; unit: string }[];
  asks: { id: string | null; kind: string; title: string; detail: string }[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  sections: { kind: string; title: string; placeholder: string }[];
  /** Pre-fill every KPI reported before, so nobody retypes last month's names. */
  carryMetrics: boolean;
  suggestedAsk: boolean;
}

/**
 * The shapes the research kept converging on. Visible's default is
 * Highlights / Lowlights / Asks + KPIs; Paperstreet adds TL;DR, Product,
 * Financial and Team; every "how to write an investor update" guide says the
 * same thing — short, regular, honest about the bad news, and always ask.
 */
export const TEMPLATES: Template[] = [
  {
    id: "monthly",
    name: "Monthly update",
    description: "The classic: highlights, lowlights, KPIs and asks.",
    sections: [
      { kind: "highlights", title: "Highlights", placeholder: "What went well this month?" },
      { kind: "lowlights", title: "Lowlights", placeholder: "What didn't — and what you're doing about it." },
      { kind: "product", title: "Product", placeholder: "What shipped, what's next." },
      { kind: "team", title: "Team", placeholder: "Hires, departures, open roles." },
    ],
    carryMetrics: true,
    suggestedAsk: true,
  },
  {
    id: "quarterly",
    name: "Quarterly / board",
    description: "A fuller review: financials, goals vs actuals, next quarter.",
    sections: [
      { kind: "summary", title: "Quarter in review", placeholder: "The three things that mattered." },
      { kind: "financial", title: "Financials", placeholder: "Revenue, burn, runway, cash in bank." },
      { kind: "goals", title: "Goals vs actuals", placeholder: "What you said you'd do, and what happened." },
      { kind: "next", title: "Next quarter", placeholder: "Goals and the plan to hit them." },
    ],
    carryMetrics: true,
    suggestedAsk: true,
  },
  {
    id: "fundraising",
    name: "Fundraising",
    description: "Announce a round, share terms, ask for intros.",
    sections: [
      { kind: "round", title: "The round", placeholder: "Amount, instrument, timing, who's leading." },
      { kind: "why-now", title: "Why now", placeholder: "Traction and what the money unlocks." },
    ],
    carryMetrics: true,
    suggestedAsk: true,
  },
  {
    id: "milestone",
    name: "Milestone",
    description: "One piece of news worth its own post.",
    sections: [{ kind: "text", title: "", placeholder: "What happened, and why it matters." }],
    carryMetrics: false,
    suggestedAsk: false,
  },
  {
    id: "blank",
    name: "Blank",
    description: "Start from nothing.",
    sections: [{ kind: "text", title: "", placeholder: "Write your update…" }],
    carryMetrics: false,
    suggestedAsk: false,
  },
];

export function monthTitle(now: Date = new Date()): string {
  return `${now.toLocaleString("en-US", { month: "long" })} ${now.getFullYear()} update`;
}

/**
 * A fresh composer from a template. `metrics` is every series reported so far:
 * the rows come pre-filled with their names and units and an empty value, and
 * the composer shows last value beside each — the "never retype your KPIs"
 * property Visible gets from integrations, without one.
 */
export function fromTemplate(
  template: Template,
  metrics: MetricSeries[],
  categoryId = "",
): ComposerState {
  return {
    title: template.id === "monthly" ? monthTitle() : "",
    summary: "",
    categoryId,
    sections: template.sections.map((s) => ({ kind: s.kind, title: s.title, body: "" })),
    metrics: template.carryMetrics
      ? metrics.map((m) => ({ name: m.name, value: "", unit: m.unit }))
      : [],
    asks: template.suggestedAsk ? [{ id: null, kind: "intro", title: "", detail: "" }] : [],
  };
}

/**
 * Start from a published update: Paperstreet's "duplicate the last one".
 * Section headings and KPI names carry over, the words and numbers do not —
 * reusing last month's body text verbatim is how an update goes out stale.
 */
export function fromPrevious(post: PostView): ComposerState {
  return {
    title: monthTitle(),
    summary: "",
    categoryId: post.card.category_id,
    sections: post.sections.map((s) => ({ kind: s.kind, title: s.title, body: "" })),
    metrics: post.metrics.map((m) => ({ name: m.name, value: "", unit: m.unit })),
    asks: [],
  };
}

/** Load a published update into the composer, for editing it in place. */
export function fromPost(post: PostView): ComposerState {
  return {
    title: post.card.title,
    summary: post.card.summary,
    categoryId: post.card.category_id,
    sections: post.sections.map((s) => ({ ...s })),
    metrics: post.metrics.map((m) => ({ ...m })),
    asks: post.asks.map((a) => ({ id: a.id, kind: a.kind, title: a.title, detail: a.detail })),
  };
}

/**
 * Cabal's "thank your contributors": one section naming everyone whose offer
 * of help was accepted since the last update. Public thanks is most of why
 * people offer again.
 */
export function thanksSection(contributions: ContributionView[]): {
  kind: string;
  title: string;
  body: string;
} | null {
  if (contributions.length === 0) return null;
  const lines = contributions.map((c) => {
    const who = personLabel(c.name, c.account) + (c.firm ? ` (${c.firm})` : "");
    return `• ${who} — ${askKind(c.ask_kind).label.toLowerCase()}: ${c.ask_title}`;
  });
  return { kind: "thanks", title: "Thank you", body: lines.join("\n") };
}

/** What `publish_update` gets: the draft with its blanks removed. */
export function toInput(state: ComposerState): UpdateInput {
  return {
    title: state.title.trim(),
    summary: state.summary.trim(),
    category_id: state.categoryId,
    sections: state.sections
      .filter((s) => s.body.trim())
      .map((s) => ({ kind: s.kind, title: s.title.trim(), body: s.body.trim() })),
    metrics: state.metrics
      .filter((m) => m.name.trim() && m.value.trim())
      .map((m) => ({ name: m.name.trim(), value: m.value.trim(), unit: m.unit.trim() })),
    asks: state.asks
      .filter((a) => a.title.trim())
      .map((a) => ({ id: a.id, kind: a.kind, title: a.title.trim(), detail: a.detail.trim() })),
  };
}

/** Why the Publish button is disabled, or null when it is not. */
export function publishBlocker(state: ComposerState): string | null {
  if (!state.title.trim()) return "Give the update a title.";
  const input = toInput(state);
  if (input.sections.length === 0 && input.metrics.length === 0 && !input.summary)
    return "Write at least one section, KPI or summary.";
  return null;
}

/** A draft's payload is only ever written by this module, but it is still
 *  storage: parse defensively and fall back rather than crash the composer. */
export function parseDraft(payload: string): ComposerState | null {
  try {
    const v = JSON.parse(payload) as Partial<ComposerState>;
    if (typeof v !== "object" || v === null) return null;
    return {
      title: String(v.title ?? ""),
      summary: String(v.summary ?? ""),
      categoryId: String(v.categoryId ?? ""),
      sections: Array.isArray(v.sections) ? v.sections : [],
      metrics: Array.isArray(v.metrics) ? v.metrics : [],
      asks: Array.isArray(v.asks) ? v.asks : [],
    };
  } catch {
    return null;
  }
}
