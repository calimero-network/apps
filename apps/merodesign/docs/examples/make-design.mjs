/**
 * Builds a full web-application design as a Mero Design project.
 *
 * Deliberately uses ONLY what the app supports today (rect / circle / text) so the
 * output is an honest picture of what can be produced right now. Every place a
 * missing feature forced a workaround is marked with a `WORKAROUND:` comment.
 */
import { writeFileSync } from 'node:fs';

const OUT = new URL('.', import.meta.url).pathname; // this directory

const C = {
  bg: '#F7F8FA',
  white: '#FFFFFF',
  border: '#E2E8F0',
  ink: '#0F172A',
  slate: '#475569',
  muted: '#64748B',
  faint: '#94A3B8',
  indigo: '#4F46E5',
  indigoSoft: '#EEF2FF',
  bar: '#6366F1',
  barSoft: '#C7D2FE',
  good: '#16A34A',
  goodSoft: '#DCFCE7',
  bad: '#DC2626',
  badSoft: '#FEE2E2',
  rowline: '#F1F5F9',
  chip: '#F1F5F9',
  grid: '#EEF2F6',
};

let z = 0;
const els = [];
const NOW = 1770000000000;

function push(kind, x, y, width, height, opts = {}) {
  const el = {
    id: `el-${String(els.length + 1).padStart(3, '0')}`,
    data: { kind, ...(opts.data ?? {}) },
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    rotation: 0,
    fill: opts.fill ?? 'transparent',
    stroke: opts.stroke ?? 'transparent',
    strokeWidth: opts.strokeWidth ?? 0,
    opacity: opts.opacity ?? 100,
    layerIndex: z++,
    createdBy: 'test-identity',
    createdAt: NOW,
    updatedAt: NOW,
    label: opts.label ?? null,
  };
  els.push(el);
  return el;
}

const rect = (x, y, w, h, fill, o = {}) => push('rect', x, y, w, h, { fill, ...o });
const circle = (x, y, d, fill, o = {}) => push('circle', x, y, d, d, { fill, ...o });
const text = (x, y, content, size, fill, o = {}) =>
  push('text', x, y, o.w ?? content.length * size * 0.6, size * 1.4, {
    fill,
    data: {
      content,
      fontSize: size,
      fontFamily: o.font ?? 'sans-serif',
      bold: !!o.bold,
      italic: false,
      text_align: o.align ?? 'left',
      vertical_align: 'top',
    },
  });

/* ── page ground ─────────────────────────────────────────────────────────── */
// WORKAROUND: there are no frames/artboards, so "the 1440x900 screen" is just a
// rect that happens to be at the back. Nothing clips to it.
rect(0, 0, 1440, 900, C.bg, { label: 'page/background' });

/* ── top bar ─────────────────────────────────────────────────────────────── */
rect(0, 0, 1440, 64, C.white, { stroke: C.border, strokeWidth: 1, label: 'topbar' });
circle(24, 20, 24, C.indigo, { label: 'topbar/logo' });
text(58, 30, 'Northwind', 16, C.ink, { bold: true });
// WORKAROUND: no rounded corners (PR 13), so the search field is a hard rectangle.
rect(300, 16, 420, 32, C.chip, { label: 'topbar/search' });
text(316, 25, 'Search customers, invoices, products', 13, C.faint);
text(1200, 26, 'Notifications', 12, C.muted);
circle(1300, 20, 24, C.badSoft, { label: 'topbar/badge' });
text(1309, 27, '3', 12, C.bad, { bold: true });
circle(1384, 20, 24, C.barSoft, { label: 'topbar/avatar' });
text(1391, 27, 'FD', 11, C.indigo, { bold: true });

/* ── sidebar ─────────────────────────────────────────────────────────────── */
rect(0, 64, 220, 836, C.white, { stroke: C.border, strokeWidth: 1, label: 'sidebar' });
rect(12, 84, 196, 36, C.indigoSoft, { label: 'sidebar/active' });
const nav = [
  ['Overview', true],
  ['Customers', false],
  ['Invoices', false],
  ['Products', false],
  ['Reports', false],
  ['Settings', false],
];
nav.forEach(([name, active], i) => {
  const y = 94 + i * 44;
  circle(28, y - 2, 16, active ? C.indigo : C.faint, { opacity: active ? 100 : 40 });
  text(56, y, name, 13, active ? C.indigo : C.slate, { bold: !!active });
});
text(28, 380, 'WORKSPACES', 10, C.faint, { bold: true });
['Acme Corp', 'Globex', 'Initech'].forEach((w, i) => {
  text(28, 406 + i * 32, w, 13, C.slate);
});

/* ── page heading + actions ──────────────────────────────────────────────── */
text(252, 88, 'Overview', 26, C.ink, { bold: true });
text(252, 126, 'Last 30 days, updated 2 minutes ago', 13, C.muted);
rect(1160, 88, 84, 36, C.white, { stroke: '#CBD5E1', strokeWidth: 1, label: 'btn/export' });
text(1178, 99, 'Export', 13, C.slate);
rect(1256, 88, 160, 36, C.indigo, { label: 'btn/primary' });
text(1281, 99, 'New invoice', 13, C.white, { bold: true });

/* ── KPI cards ───────────────────────────────────────────────────────────── */
const kpis = [
  ['Revenue', '$48,230', '+12.4% vs last month', C.good],
  ['Active users', '2,451', '+3.1% vs last month', C.good],
  ['Churn', '1.8%', '-0.4% vs last month', C.bad],
  ['Avg order', '$312', '+8.0% vs last month', C.good],
];
kpis.forEach(([label, value, delta, deltaColor], i) => {
  const x = 252 + i * 297;
  rect(x, 160, 273, 108, C.white, { stroke: C.border, strokeWidth: 1, label: `kpi/${label}` });
  text(x + 20, 180, label, 12, C.muted);
  text(x + 20, 200, value, 26, C.ink, { bold: true });
  text(x + 20, 240, delta, 12, deltaColor);
});

/* ── chart card ──────────────────────────────────────────────────────────── */
rect(252, 292, 861, 300, C.white, { stroke: C.border, strokeWidth: 1, label: 'card/chart' });
text(272, 312, 'Revenue by week', 14, C.ink, { bold: true });
text(272, 334, 'Twelve week trend', 12, C.faint);
// WORKAROUND: a 1px line is invisible today (PR 2), so gridlines are 1px-tall rects.
[380, 440, 500].forEach((y) => rect(292, y, 800, 1, C.grid, { label: 'chart/gridline' }));
const bars = [38, 52, 47, 63, 58, 74, 69, 88, 81, 96, 104, 118];
bars.forEach((h, i) => {
  const x = 292 + i * 66;
  rect(x, 540 - h, 34, h, i === bars.length - 1 ? C.indigo : C.bar, { label: `chart/bar-${i + 1}` });
  text(x + 6, 548, `W${i + 1}`, 10, C.faint);
});

/* ── activity card ───────────────────────────────────────────────────────── */
rect(1137, 292, 279, 300, C.white, { stroke: C.border, strokeWidth: 1, label: 'card/activity' });
text(1157, 312, 'Recent activity', 14, C.ink, { bold: true });
const acts = [
  ['AK', 'Ada Keller', 'paid invoice #2481', C.barSoft],
  ['JM', 'Jon Moss', 'added 3 products', C.goodSoft],
  ['SR', 'Sara Rye', 'requested a refund', C.badSoft],
  ['TL', 'Tom Lund', 'upgraded to Pro', C.chip],
];
acts.forEach(([initials, name, action, tint], i) => {
  const y = 348 + i * 56;
  circle(1157, y, 28, tint);
  text(1165, y + 8, initials, 11, C.slate, { bold: true });
  text(1197, y + 2, name, 13, C.ink, { bold: true });
  text(1197, y + 20, action, 11, C.muted);
});

/* ── table card ──────────────────────────────────────────────────────────── */
rect(252, 616, 1164, 260, C.white, { stroke: C.border, strokeWidth: 1, label: 'card/table' });
text(272, 636, 'Latest invoices', 14, C.ink, { bold: true });
rect(253, 664, 1162, 32, '#F8FAFC', { label: 'table/header' });
const cols = [
  ['Invoice', 272],
  ['Customer', 432],
  ['Status', 712],
  ['Amount', 932],
  ['Date', 1132],
];
cols.forEach(([name, x]) => text(x, 673, name.toUpperCase(), 10, C.muted, { bold: true }));
const rows = [
  ['#2481', 'Ada Keller', 'Paid', C.goodSoft, C.good, '$1,240.00', '12 Aug 2026'],
  ['#2480', 'Globex Ltd', 'Pending', '#FEF3C7', '#B45309', '$860.00', '11 Aug 2026'],
  ['#2479', 'Initech', 'Paid', C.goodSoft, C.good, '$2,110.00', '11 Aug 2026'],
  ['#2478', 'Sara Rye', 'Refunded', C.badSoft, C.bad, '$320.00', '10 Aug 2026'],
];
rows.forEach(([inv, cust, status, chipBg, chipFg, amount, date], i) => {
  const y = 704 + i * 42;
  // WORKAROUND: row separators are 1px rects for the same reason as the gridlines.
  if (i > 0) rect(253, y - 10, 1162, 1, C.rowline, { label: 'table/rowline' });
  text(272, y, inv, 12, C.ink, { bold: true });
  text(432, y, cust, 12, C.slate);
  rect(712, y - 4, 76, 22, chipBg, { label: `table/chip-${status}` });
  text(722, y, status, 11, chipFg, { bold: true });
  text(932, y, amount, 12, C.ink);
  text(1132, y, date, 12, C.muted);
});

/* ── write both artefacts ────────────────────────────────────────────────── */
const snapshot = {
  version: 1,
  exportedAt: NOW,
  boardName: 'Northwind Analytics',
  boardDescription: 'Dashboard design built entirely inside Mero Design',
  elements: els,
  comments: [
    {
      id: 'c-1',
      x: 1113,
      y: 300,
      content: 'Chart card needs 8px corner radius once that lands',
      author: 'test-identity',
      createdAt: NOW,
      replies: [],
    },
  ],
};

writeFileSync(`${OUT}/northwind.merodesign`, JSON.stringify(snapshot, null, 2));
writeFileSync(`${OUT}/northwind-elements.json`, JSON.stringify(els));

const byKind = els.reduce((a, e) => ((a[e.data.kind] = (a[e.data.kind] ?? 0) + 1), a), {});
console.log(`${els.length} elements:`, JSON.stringify(byKind));
console.log('wrote northwind.merodesign + northwind-elements.json');
