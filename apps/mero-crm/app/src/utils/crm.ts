/**
 * The CRM's thinking, as pure functions.
 *
 * Everything that makes the app more than a list of rows lives here: money and
 * due-date formatting, the deal-health score, the next-best-action suggestions,
 * the follow-up email draft, the prompt handed to an AI assistant, and the
 * pipeline statistics the Insights page draws.
 *
 * Deliberately deterministic and local. There is no server in a Calimero app to
 * call a model from, and a sales team's pipeline is exactly the data it should
 * not have to ship to one to get a nudge. The assistant is a set of rules a
 * sales manager would apply by eye — "no next step", "gone quiet", "close date
 * slipped" — applied to every deal, every time. For the open-ended part
 * (strategy, a tailored email) `buildAssistantPrompt` packages the deal for
 * whichever AI the user already trusts, one click away.
 */
import type {
  ActivityView,
  ContactView,
  DealDetail,
  DealView,
  StageView,
} from '../generated/CrmClient';

export const DAY_MS = 86_400_000;

export const ACTIVITY_KINDS = ['call', 'meeting', 'task', 'email', 'deadline'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_LABEL: Record<string, string> = {
  call: 'Call',
  meeting: 'Meeting',
  task: 'Task',
  email: 'Email',
  deadline: 'Deadline',
};

// ── Money ──────────────────────────────────────────────────────────────────

/** `$12,400` or, compact, `$12.4K`. Falls back to `12,400 XYZ` for a code Intl
 *  does not know, rather than throwing mid-render. */
export function formatMoney(value: number, currency: string, compact = false): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: compact && value >= 1000 ? 1 : 0,
      notation: compact ? 'compact' : 'standard',
    }).format(value);
  } catch {
    return `${Math.round(value).toLocaleString()} ${currency}`;
  }
}

/** Parse what a person types into a value field: `12k`, `1.5m`, `$12,400`. */
export function parseMoney(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/[\s,$€£¥]/g, '');
  if (!s) return 0;
  const m = s.match(/^(\d+(?:\.\d+)?)([km]?)$/);
  if (!m) return null;
  const mult = m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1;
  return Math.round(parseFloat(m[1]) * mult);
}

// ── Dates ──────────────────────────────────────────────────────────────────

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later';

/** "Overdue 3d" / "Today" / "Tomorrow" / "In 4 days" / "Mar 3". */
export function dueLabel(due: number, now: number = Date.now()): { text: string; tone: DueTone } {
  const d = daysBetween(now, due);
  if (d < 0) return { text: `Overdue ${-d}d`, tone: 'overdue' };
  if (d === 0) return { text: 'Today', tone: 'today' };
  if (d === 1) return { text: 'Tomorrow', tone: 'soon' };
  if (d < 7) return { text: `In ${d} days`, tone: 'soon' };
  return {
    text: new Date(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    tone: 'later',
  };
}

/** `YYYY-MM-DD` for an `<input type="date">`, in local time. */
export function toDateInput(ms: number | null | undefined): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Inverse of `toDateInput`: local noon, so a timezone shift never moves the day. */
export function fromDateInput(value: string): number | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime();
}

/** A due time `days` from now, at 10:00 local — when people actually call. */
export function dueInDays(days: number, now: number = Date.now()): number {
  const d = new Date(startOfDay(now) + days * DAY_MS);
  d.setHours(10, 0, 0, 0);
  return d.getTime();
}

// ── Deal health ────────────────────────────────────────────────────────────

export type HealthLevel = 'healthy' | 'at-risk' | 'critical';

export interface DealHealth {
  /** 0..100 */
  score: number;
  level: HealthLevel;
  /** Nothing has happened on the deal for longer than the pipeline allows. */
  rotting: boolean;
  /** Days since anything happened (done activity, note, stage move, creation). */
  idleDays: number;
  reasons: string[];
  /** Stage probability, adjusted by health. */
  winLikelihood: number;
}

/** Most recent sign of life on a deal. */
export function lastTouch(deal: DealView): number {
  return Math.max(deal.last_touch_at ?? 0, deal.stage_entered_at, deal.created_at);
}

/**
 * Score an open deal the way a sales manager reads the board: is there a next
 * step, is it on time, has anyone touched this lately, is the close date real,
 * do we even know who we are talking to. Closed deals are simply healthy.
 */
export function dealHealth(deal: DealView, rottingDays: number, now: number = Date.now()): DealHealth {
  if (deal.status !== 'open') {
    return {
      score: 100, level: 'healthy', rotting: false, idleDays: 0, reasons: [],
      winLikelihood: deal.probability,
    };
  }
  let score = 100;
  const reasons: string[] = [];
  const idleDays = Math.max(0, daysBetween(lastTouch(deal), now));
  const rotting = idleDays > rottingDays;

  if (!deal.next_activity) {
    score -= 30;
    reasons.push('No next step scheduled');
  } else if (deal.next_activity.due_at < startOfDay(now)) {
    const late = daysBetween(deal.next_activity.due_at, now);
    score -= 25;
    reasons.push(`Next step overdue by ${late} day${late === 1 ? '' : 's'}`);
  }
  if (rotting) {
    score -= 30;
    reasons.push(`No activity in ${idleDays} days`);
  } else if (idleDays > rottingDays / 2) {
    score -= 10;
    reasons.push(`Quiet for ${idleDays} days`);
  }
  const inStage = Math.max(0, daysBetween(deal.stage_entered_at, now));
  if (inStage > rottingDays * 2) {
    score -= 10;
    reasons.push(`In this stage for ${inStage} days`);
  }
  if (deal.expected_close == null) {
    score -= 5;
    reasons.push('No expected close date');
  } else if (deal.expected_close < startOfDay(now)) {
    score -= 20;
    reasons.push('Expected close date has passed');
  }
  if (!deal.contact_id) {
    score -= 10;
    reasons.push('No contact person linked');
  }
  if (!deal.owner) {
    score -= 5;
    reasons.push('Nobody owns this deal');
  }
  score = Math.max(0, Math.min(100, score));
  const level: HealthLevel = score >= 80 ? 'healthy' : score >= 45 ? 'at-risk' : 'critical';
  const winLikelihood = Math.round(deal.probability * (0.5 + score / 200));
  return { score, level, rotting, idleDays, reasons, winLikelihood };
}

// ── Next best actions ──────────────────────────────────────────────────────

export interface SuggestedActivity {
  kind: ActivityKind;
  subject: string;
  dueInDays: number;
}

export interface NextAction {
  id: string;
  title: string;
  why: string;
  /** When present, one click schedules it. */
  activity?: SuggestedActivity;
  /** When present, the UI focuses that field instead. */
  field?: 'contact' | 'expected_close' | 'owner';
}

/** The playbook step for where a deal sits in the pipeline (0 = first stage). */
export function playbookStep(stageIndex: number, stageCount: number): SuggestedActivity {
  const phase = stageCount <= 1 ? 0 : stageIndex / (stageCount - 1);
  if (phase < 0.2) return { kind: 'call', subject: 'Discovery call: qualify need, budget and timeline', dueInDays: 1 };
  if (phase < 0.45) return { kind: 'meeting', subject: 'Book a demo with the decision maker', dueInDays: 3 };
  if (phase < 0.7) return { kind: 'email', subject: 'Send the proposal', dueInDays: 2 };
  if (phase < 0.9) return { kind: 'call', subject: 'Follow up on the proposal', dueInDays: 2 };
  return { kind: 'meeting', subject: 'Agree final terms and close', dueInDays: 2 };
}

export function nextBestActions(
  deal: DealView,
  stages: StageView[],
  rottingDays: number,
  now: number = Date.now(),
): NextAction[] {
  if (deal.status !== 'open') return [];
  const out: NextAction[] = [];
  const health = dealHealth(deal, rottingDays, now);
  const idx = Math.max(0, stages.findIndex((s) => s.id === deal.stage_id));

  if (deal.next_activity && deal.next_activity.due_at < startOfDay(now)) {
    out.push({
      id: 'overdue',
      title: `Finish or reschedule “${deal.next_activity.subject}”`,
      why: 'An overdue step tells the buyer the deal is not a priority.',
    });
  }
  if (health.rotting) {
    out.push({
      id: 'reengage',
      title: 'Re-engage with a short check-in',
      why: `Nothing has happened in ${health.idleDays} days. Deals that go quiet rarely come back on their own.`,
      activity: { kind: 'email', subject: 'Check-in: keep the conversation moving', dueInDays: 0 },
    });
  }
  if (!deal.next_activity) {
    const step = playbookStep(idx, stages.length);
    out.push({
      id: 'playbook',
      title: step.subject,
      why: `The usual next step at ${stages[idx]?.name ?? 'this stage'}. Every open deal should have one.`,
      activity: step,
    });
  }
  if (!deal.contact_id) {
    out.push({
      id: 'contact',
      title: 'Link the person you are talking to',
      why: 'A deal without a contact is a deal nobody can follow up on.',
      field: 'contact',
    });
  }
  if (deal.expected_close == null || deal.expected_close < startOfDay(now)) {
    out.push({
      id: 'close-date',
      title: deal.expected_close == null ? 'Set an expected close date' : 'Update the slipped close date',
      why: 'The forecast is only as honest as its close dates.',
      field: 'expected_close',
    });
  }
  if (!deal.owner) {
    out.push({
      id: 'owner',
      title: 'Give the deal an owner',
      why: 'Shared ownership is no ownership.',
      field: 'owner',
    });
  }
  const late = stages.length > 1 && idx >= Math.floor((stages.length - 1) * 0.6);
  if (late && deal.next_activity && out.length === 0) {
    out.push({
      id: 'decision-maker',
      title: 'Confirm the decision maker and sign-off process',
      why: 'Late-stage deals slip on procurement, not on interest.',
      activity: { kind: 'call', subject: 'Confirm decision process and sign-off', dueInDays: 3 },
    });
  }
  return out;
}

// ── Writing help ───────────────────────────────────────────────────────────

function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'there';
}

/** A short, stage-appropriate follow-up email the user can copy and edit. */
export function draftFollowUpEmail(
  deal: DealView,
  stages: StageView[],
  contact: ContactView | null,
  sender: string,
): { subject: string; body: string } {
  const idx = Math.max(0, stages.findIndex((s) => s.id === deal.stage_id));
  const phase = stages.length <= 1 ? 0 : idx / (stages.length - 1);
  const org = deal.organization || contact?.organization || 'your team';
  const hi = `Hi ${firstName(contact?.name ?? deal.contact_name)},`;
  const sign = `\n\nBest,\n${sender || 'Me'}`;
  let subject: string;
  let middle: string;
  if (phase < 0.2) {
    subject = `Quick question about ${org}`;
    middle = `I'd love to learn a little more about what ${org} is trying to solve, and whether we're a fit. Would you have 20 minutes this week for a quick call?`;
  } else if (phase < 0.45) {
    subject = `Next step: a short demo for ${org}`;
    middle = `Thanks for the conversation so far. The natural next step is a 30-minute walkthrough with whoever else should weigh in. Could you suggest a couple of times that work?`;
  } else if (phase < 0.7) {
    subject = `Proposal for ${org}`;
    middle = `As promised, here is the proposal we discussed for "${deal.title}". I've kept it to what we agreed matters most. Happy to walk through it together.`;
  } else if (phase < 0.9) {
    subject = `Following up on the proposal`;
    middle = `I wanted to check whether you've had a chance to review the proposal, and whether there are any questions or changes I can help with before you decide.`;
  } else {
    subject = `Finalising ${deal.title}`;
    middle = `We're nearly there. Is there anything left on your side, contract, sign-off or timing, that I can help unblock so we can get started?`;
  }
  return { subject, body: `${hi}\n\n${middle}${sign}` };
}

/**
 * Everything an AI assistant needs to coach this deal, in one paste. No ids,
 * no keys — just the business context a person would give a colleague.
 */
export function buildAssistantPrompt(
  detail: DealDetail,
  stages: StageView[],
  currency: string,
  rottingDays: number,
  now: number = Date.now(),
): string {
  const { deal, contact, activities, notes } = detail;
  const health = dealHealth(deal, rottingDays, now);
  const stage = stages.find((s) => s.id === deal.stage_id);
  const lines: string[] = [
    'You are an experienced B2B sales coach. Help me move this deal forward.',
    '',
    '## Deal',
    `- Title: ${deal.title}`,
    `- Value: ${formatMoney(deal.value, currency)}`,
    `- Organization: ${deal.organization || '(unknown)'}`,
    `- Stage: ${stage?.name ?? '(unknown)'} (${deal.probability}% stage probability) of ${stages.map((s) => s.name).join(' → ')}`,
    `- Status: ${deal.status}${deal.lost_reason ? ` (lost: ${deal.lost_reason})` : ''}`,
    `- Expected close: ${deal.expected_close ? new Date(deal.expected_close).toDateString() : '(not set)'}`,
    `- Source: ${deal.source || '(unknown)'}`,
    `- Health: ${health.score}/100 (${health.level})${health.reasons.length ? ` — ${health.reasons.join('; ')}` : ''}`,
  ];
  if (contact) {
    lines.push('', '## Contact', `- ${contact.name}${contact.job_title ? `, ${contact.job_title}` : ''}${contact.organization ? ` at ${contact.organization}` : ''}`);
  }
  if (activities.length) {
    lines.push('', '## Activities');
    for (const a of activities.slice(-15)) {
      lines.push(`- [${a.done ? 'done' : 'open'}] ${ACTIVITY_LABEL[a.kind] ?? a.kind}: ${a.subject} (due ${new Date(a.due_at).toDateString()})${a.note ? ` — ${a.note}` : ''}`);
    }
  }
  if (notes.length) {
    lines.push('', '## Notes (newest first)');
    for (const n of notes.slice(0, 10)) lines.push(`- ${new Date(n.created_at).toDateString()}: ${n.body.replace(/\s+/g, ' ')}`);
  }
  lines.push(
    '',
    '## What I need',
    '1. The two or three biggest risks to closing this deal, and how to address each.',
    '2. The single best next step, with a date.',
    '3. A short, specific follow-up email I can send today.',
  );
  return lines.join('\n');
}

// ── Pipeline statistics ────────────────────────────────────────────────────

export interface StageStat {
  stage: StageView;
  count: number;
  value: number;
  weighted: number;
}

export interface PipelineStats {
  openCount: number;
  openValue: number;
  weightedValue: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
  lostValue: number;
  /** 0..100, or null before anything has closed. */
  winRate: number | null;
  avgWonValue: number | null;
  avgCycleDays: number | null;
  wonThisMonth: number;
  perStage: StageStat[];
  lostReasons: { reason: string; count: number }[];
  byOwner: { owner: string; wonValue: number; openValue: number; wonCount: number }[];
  /** Open weighted value by expected-close month, next six months, plus undated. */
  forecast: { label: string; value: number; weighted: number }[];
}

export function computeStats(deals: DealView[], stages: StageView[], now: number = Date.now()): PipelineStats {
  const open = deals.filter((d) => d.status === 'open');
  const won = deals.filter((d) => d.status === 'won');
  const lost = deals.filter((d) => d.status === 'lost');
  const sum = (xs: DealView[]) => xs.reduce((a, d) => a + d.value, 0);
  const weighted = (d: DealView) => Math.round((d.value * d.probability) / 100);

  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const cycles = won
    .filter((d) => d.closed_at)
    .map((d) => Math.max(0, daysBetween(d.created_at, d.closed_at as number)));

  const reasons = new Map<string, number>();
  for (const d of lost) {
    const r = d.lost_reason.trim() || 'No reason given';
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }

  const owners = new Map<string, { wonValue: number; openValue: number; wonCount: number }>();
  for (const d of deals) {
    if (d.status === 'lost') continue;
    const key = d.owner || 'Unassigned';
    const o = owners.get(key) ?? { wonValue: 0, openValue: 0, wonCount: 0 };
    if (d.status === 'won') { o.wonValue += d.value; o.wonCount += 1; } else { o.openValue += d.value; }
    owners.set(key, o);
  }

  const forecast: PipelineStats['forecast'] = [];
  for (let i = 0; i < 6; i++) {
    const start = new Date(monthStart);
    start.setMonth(start.getMonth() + i);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    const inMonth = open.filter((d) => {
      const c = d.expected_close;
      // Slipped dates count in the current month: they are due now, not never.
      if (c == null) return false;
      return i === 0 ? c < end.getTime() : c >= start.getTime() && c < end.getTime();
    });
    forecast.push({
      label: start.toLocaleDateString(undefined, { month: 'short', year: i === 0 || start.getMonth() === 0 ? '2-digit' : undefined }),
      value: sum(inMonth),
      weighted: inMonth.reduce((a, d) => a + weighted(d), 0),
    });
  }
  const undated = open.filter((d) => d.expected_close == null);
  if (undated.length) {
    forecast.push({ label: 'No date', value: sum(undated), weighted: undated.reduce((a, d) => a + weighted(d), 0) });
  }

  const closed = won.length + lost.length;
  return {
    openCount: open.length,
    openValue: sum(open),
    weightedValue: open.reduce((a, d) => a + weighted(d), 0),
    wonCount: won.length,
    wonValue: sum(won),
    lostCount: lost.length,
    lostValue: sum(lost),
    winRate: closed ? Math.round((won.length / closed) * 100) : null,
    avgWonValue: won.length ? Math.round(sum(won) / won.length) : null,
    avgCycleDays: cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null,
    wonThisMonth: sum(won.filter((d) => (d.closed_at ?? 0) >= monthStart.getTime())),
    perStage: stages.map((stage) => {
      const inStage = open.filter((d) => d.stage_id === stage.id);
      return { stage, count: inStage.length, value: sum(inStage), weighted: inStage.reduce((a, d) => a + weighted(d), 0) };
    }),
    lostReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    byOwner: [...owners.entries()].map(([owner, o]) => ({ owner, ...o })).sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue),
    forecast,
  };
}

// ── Activities ─────────────────────────────────────────────────────────────

export type ActivityBucket = 'overdue' | 'today' | 'upcoming' | 'done';

export function bucketActivities(list: ActivityView[], now: number = Date.now()): Record<ActivityBucket, ActivityView[]> {
  const today = startOfDay(now);
  const tomorrow = today + DAY_MS;
  const out: Record<ActivityBucket, ActivityView[]> = { overdue: [], today: [], upcoming: [], done: [] };
  for (const a of list) {
    if (a.done) out.done.push(a);
    else if (a.due_at < today) out.overdue.push(a);
    else if (a.due_at < tomorrow) out.today.push(a);
    else out.upcoming.push(a);
  }
  out.done.sort((a, b) => (b.done_at ?? 0) - (a.done_at ?? 0));
  return out;
}

// ── Search ─────────────────────────────────────────────────────────────────

export function dealMatches(deal: DealView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [deal.title, deal.organization, deal.contact_name ?? '', deal.owner ?? '', deal.source]
    .some((f) => f.toLowerCase().includes(q));
}

export function contactMatches(c: ContactView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [c.name, c.email, c.phone, c.organization, c.job_title].some((f) => f.toLowerCase().includes(q));
}
