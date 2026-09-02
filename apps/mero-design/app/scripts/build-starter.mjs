/**
 * Generates the starter project shipped with the app.
 *
 *   node scripts/build-starter.mjs   →  src/starter/starter-project.json
 *
 * Five screens laid out left to right the way a Figma file looks, plus a design
 * system board: a type scale across three families, a button matrix in three
 * sizes and four variants, colour swatches, and form controls.
 *
 * Only kinds the app renders today are used (rect / circle / text). Anywhere a
 * missing feature forced a workaround it is marked WORKAROUND, and each one is
 * tracked in docs/fix-plan.md.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/starter/starter-project.json');

/* ── palette ─────────────────────────────────────────────────────────────── */
const C = {
  page: '#F7F8FA', white: '#FFFFFF', border: '#E2E8F0', line: '#F1F5F9',
  ink: '#0F172A', body: '#334155', muted: '#64748B', faint: '#94A3B8',
  indigo: '#4F46E5', indigoHover: '#4338CA', indigoSoft: '#EEF2FF',
  bar: '#6366F1', barSoft: '#C7D2FE',
  good: '#16A34A', goodSoft: '#DCFCE7',
  warn: '#B45309', warnSoft: '#FEF3C7',
  bad: '#DC2626', badSoft: '#FEE2E2',
  chip: '#F1F5F9', grid: '#EEF2F6', field: '#F8FAFC',
  canvas: '#E9EBEF',
};

/* ── three families, so the file exercises real typography ───────────────── */
const F = {
  ui: 'sans-serif',
  display: 'Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const SCREEN_W = 1440;
const SCREEN_H = 900;
const GUTTER = 140;
const els = [];
let z = 0;
const NOW = 1770000000000;
let seq = 0;

function el(kind, x, y, width, height, o = {}) {
  seq += 1;
  els.push({
    id: `starter-${String(seq).padStart(3, '0')}`,
    data: { kind, ...(o.data ?? {}) },
    x: Math.round(x), y: Math.round(y),
    width: Math.round(width), height: Math.round(height),
    rotation: 0,
    fill: o.fill ?? 'transparent',
    stroke: o.stroke ?? 'transparent',
    strokeWidth: o.strokeWidth ?? 0,
    opacity: o.opacity ?? 100,
    layerIndex: z++,
    createdBy: '',
    createdAt: NOW,
    updatedAt: NOW,
    label: o.label ?? null,
  });
}

const rect = (x, y, w, h, fill, o = {}) => el('rect', x, y, w, h, { fill, ...o });
const circle = (x, y, d, fill, o = {}) => el('circle', x, y, d, d, { fill, ...o });
const text = (x, y, content, size, fill, o = {}) =>
  el('text', x, y, o.w ?? Math.ceil(content.length * size * 0.62), Math.ceil(size * 1.35), {
    fill,
    data: {
      content,
      fontSize: size,
      fontFamily: o.font ?? F.ui,
      bold: !!o.bold,
      italic: !!o.italic,
      text_align: o.align ?? 'left',
      vertical_align: 'top',
    },
  });
// WORKAROUND: a 1px line renders invisible today (fix-plan PR 3), so every rule
// and gridline in this file is a 1px-tall rect.
const rule = (x, y, w, fill = C.border) => rect(x, y, w, 1, fill, { label: 'rule' });

/** A screen: the frame name above it, then the page ground. */
function screen(ox, name) {
  text(ox, -34, name, 13, C.faint, { font: F.mono, label: `frame/${name}` });
  // WORKAROUND: no frames/artboards, so a screen is a rect nothing clips to.
  rect(ox, 0, SCREEN_W, SCREEN_H, C.page, { label: `screen/${name}` });
  return ox;
}

/* ── shared chrome ───────────────────────────────────────────────────────── */
function topbar(ox, active) {
  rect(ox, 0, SCREEN_W, 64, C.white, { stroke: C.border, strokeWidth: 1, label: 'topbar' });
  circle(ox + 24, 20, 24, C.indigo, { label: 'topbar/logo' });
  text(ox + 58, 30, 'Northwind', 16, C.ink, { bold: true, font: F.display });
  rect(ox + 300, 16, 380, 32, C.chip, { label: 'topbar/search' });
  text(ox + 316, 25, 'Search customers, invoices, products', 13, C.faint);
  text(ox + 1180, 26, active, 12, C.muted, { font: F.mono });
  circle(ox + 1300, 20, 24, C.badSoft);
  text(ox + 1309, 27, '3', 12, C.bad, { bold: true });
  circle(ox + 1384, 20, 24, C.barSoft, { label: 'topbar/avatar' });
  text(ox + 1391, 27, 'FD', 11, C.indigo, { bold: true });
}

function sidebar(ox, activeIndex) {
  rect(ox, 64, 220, SCREEN_H - 64, C.white, { stroke: C.border, strokeWidth: 1, label: 'sidebar' });
  const nav = ['Overview', 'Customers', 'Invoices', 'Products', 'Reports', 'Settings'];
  if (activeIndex >= 0) rect(ox + 12, 84 + activeIndex * 44, 196, 36, C.indigoSoft, { label: 'sidebar/active' });
  nav.forEach((n, i) => {
    const y = 94 + i * 44;
    const on = i === activeIndex;
    circle(ox + 28, y - 2, 16, on ? C.indigo : C.faint, { opacity: on ? 100 : 40 });
    text(ox + 56, y, n, 13, on ? C.indigo : C.body, { bold: on });
  });
  text(ox + 28, 380, 'WORKSPACES', 10, C.faint, { bold: true, font: F.mono });
  ['Acme Corp', 'Globex', 'Initech'].forEach((w, i) => text(ox + 28, 406 + i * 32, w, 13, C.body));
}

/** Button in three sizes and four variants — the same helper the design system uses. */
function button(x, y, label, { size = 'md', variant = 'primary' } = {}) {
  const dims = { sm: [86, 28, 12, 8], md: [116, 36, 13, 11], lg: [148, 44, 15, 14] }[size];
  const [w, h, fs, pad] = dims;
  const skin = {
    primary: [C.indigo, C.white, 'transparent', 0],
    secondary: [C.white, C.body, '#CBD5E1', 1],
    ghost: ['transparent', C.indigo, 'transparent', 0],
    danger: [C.bad, C.white, 'transparent', 0],
  }[variant];
  const [bg, fg, bd, bw] = skin;
  rect(x, y, w, h, bg, { stroke: bd, strokeWidth: bw, label: `btn/${variant}-${size}` });
  text(x + pad, y + (h - fs * 1.35) / 2 + 1, label, fs, fg, { bold: variant === 'primary' || variant === 'danger' });
  return w;
}

function field(x, y, w, labelText, value, { placeholder = false } = {}) {
  text(x, y, labelText, 11, C.muted, { bold: true, font: F.mono });
  rect(x, y + 18, w, 38, C.field, { stroke: C.border, strokeWidth: 1, label: `field/${labelText}` });
  text(x + 12, y + 30, value, 13, placeholder ? C.faint : C.ink);
}

/* ══════════════════════════════════════════════════════════════════════════
   SCREEN 1 — Sign in
   ══════════════════════════════════════════════════════════════════════════ */
{
  const ox = screen(0, '01 Sign in');
  rect(ox, 0, 640, SCREEN_H, C.indigo, { label: 'signin/panel' });
  circle(ox + 72, 72, 40, C.white, { opacity: 20 });
  text(ox + 84, 84, 'N', 20, C.white, { bold: true, font: F.display });
  text(ox + 72, 300, 'Invoicing that', 44, C.white, { bold: true, font: F.display });
  text(ox + 72, 356, 'runs itself.', 44, C.white, { bold: true, font: F.display });
  text(ox + 72, 432, 'Northwind keeps your books, your customers and', 15, C.barSoft);
  text(ox + 72, 456, 'your team on the same page. No spreadsheets.', 15, C.barSoft);
  text(ox + 72, 760, 'Trusted by 4,200 small businesses', 12, C.barSoft, { font: F.mono });

  const fx = ox + 800;
  text(fx, 260, 'Welcome back', 30, C.ink, { bold: true, font: F.display });
  text(fx, 306, 'Sign in to continue to your workspace.', 14, C.muted);
  field(fx, 360, 440, 'EMAIL', 'ada@acme.com');
  field(fx, 442, 440, 'PASSWORD', '••••••••••••');
  text(fx + 350, 448, 'Forgot?', 12, C.indigo);
  button(fx, 528, 'Sign in', { size: 'lg', variant: 'primary' });
  rule(fx, 600, 440);
  text(fx + 190, 590, 'or', 12, C.faint);
  button(fx, 622, 'Continue with SSO', { size: 'lg', variant: 'secondary' });
  text(fx, 700, 'New here?', 13, C.muted);
  text(fx + 74, 700, 'Create an account', 13, C.indigo, { bold: true });
}

/* ══════════════════════════════════════════════════════════════════════════
   SCREEN 2 — Overview
   ══════════════════════════════════════════════════════════════════════════ */
{
  const ox = screen(SCREEN_W + GUTTER, '02 Overview');
  topbar(ox, 'Notifications');
  sidebar(ox, 0);

  text(ox + 252, 88, 'Overview', 26, C.ink, { bold: true, font: F.display });
  text(ox + 252, 126, 'Last 30 days, updated 2 minutes ago', 13, C.muted);
  button(ox + 1160, 88, 'Export', { size: 'md', variant: 'secondary' });
  button(ox + 1290, 88, 'New invoice', { size: 'md', variant: 'primary' });

  const kpis = [
    ['Revenue', '$48,230', '+12.4% vs last month', C.good],
    ['Active users', '2,451', '+3.1% vs last month', C.good],
    ['Churn', '1.8%', '-0.4% vs last month', C.bad],
    ['Avg order', '$312', '+8.0% vs last month', C.good],
  ];
  kpis.forEach(([l, v, d, dc], i) => {
    const x = ox + 252 + i * 297;
    rect(x, 160, 273, 108, C.white, { stroke: C.border, strokeWidth: 1, label: `kpi/${l}` });
    text(x + 20, 180, l, 12, C.muted);
    text(x + 20, 200, v, 26, C.ink, { bold: true, font: F.mono });
    text(x + 20, 240, d, 12, dc);
  });

  rect(ox + 252, 292, 861, 300, C.white, { stroke: C.border, strokeWidth: 1, label: 'card/chart' });
  text(ox + 272, 312, 'Revenue by week', 14, C.ink, { bold: true });
  text(ox + 272, 334, 'Twelve week trend', 12, C.faint);
  [380, 440, 500].forEach((y) => rule(ox + 292, y, 800, C.grid));
  const bars = [38, 52, 47, 63, 58, 74, 69, 88, 81, 96, 104, 118];
  bars.forEach((h, i) => {
    const x = ox + 292 + i * 66;
    rect(x, 540 - h, 34, h, i === 11 ? C.indigo : C.bar, { label: `chart/bar-${i + 1}` });
    text(x + 6, 548, `W${i + 1}`, 10, C.faint, { font: F.mono });
  });

  rect(ox + 1137, 292, 279, 300, C.white, { stroke: C.border, strokeWidth: 1, label: 'card/activity' });
  text(ox + 1157, 312, 'Recent activity', 14, C.ink, { bold: true });
  [
    ['AK', 'Ada Keller', 'paid invoice #2481', C.barSoft],
    ['JM', 'Jon Moss', 'added 3 products', C.goodSoft],
    ['SR', 'Sara Rye', 'requested a refund', C.badSoft],
    ['TL', 'Tom Lund', 'upgraded to Pro', C.chip],
  ].forEach(([ini, name, act, tint], i) => {
    const y = 348 + i * 56;
    circle(ox + 1157, y, 28, tint);
    text(ox + 1165, y + 8, ini, 11, C.body, { bold: true, font: F.mono });
    text(ox + 1197, y + 2, name, 13, C.ink, { bold: true });
    text(ox + 1197, y + 20, act, 11, C.muted);
  });

  rect(ox + 252, 616, 1164, 260, C.white, { stroke: C.border, strokeWidth: 1, label: 'card/table' });
  text(ox + 272, 636, 'Latest invoices', 14, C.ink, { bold: true });
  rect(ox + 253, 664, 1162, 32, C.field, { label: 'table/header' });
  [['Invoice', 272], ['Customer', 432], ['Status', 712], ['Amount', 932], ['Date', 1132]]
    .forEach(([n, x]) => text(ox + x, 673, n.toUpperCase(), 10, C.muted, { bold: true, font: F.mono }));
  [
    ['#2481', 'Ada Keller', 'Paid', C.goodSoft, C.good, '$1,240.00', '12 Aug 2026'],
    ['#2480', 'Globex Ltd', 'Pending', C.warnSoft, C.warn, '$860.00', '11 Aug 2026'],
    ['#2479', 'Initech', 'Paid', C.goodSoft, C.good, '$2,110.00', '11 Aug 2026'],
    ['#2478', 'Sara Rye', 'Refunded', C.badSoft, C.bad, '$320.00', '10 Aug 2026'],
  ].forEach(([inv, cust, st, bg, fg, amt, date], i) => {
    const y = 704 + i * 42;
    if (i > 0) rule(ox + 253, y - 10, 1162, C.line);
    text(ox + 272, y, inv, 12, C.ink, { bold: true, font: F.mono });
    text(ox + 432, y, cust, 12, C.body);
    rect(ox + 712, y - 4, 76, 22, bg, { label: `chip/${st}` });
    text(ox + 722, y, st, 11, fg, { bold: true });
    text(ox + 932, y, amt, 12, C.ink, { font: F.mono });
    text(ox + 1132, y, date, 12, C.muted);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   SCREEN 3 — Invoice detail
   ══════════════════════════════════════════════════════════════════════════ */
{
  const ox = screen((SCREEN_W + GUTTER) * 2, '03 Invoice detail');
  topbar(ox, 'Invoices');
  sidebar(ox, 2);

  text(ox + 252, 88, 'Invoice #2481', 26, C.ink, { bold: true, font: F.display });
  rect(ox + 470, 92, 76, 22, C.goodSoft, { label: 'chip/Paid' });
  text(ox + 480, 96, 'Paid', 11, C.good, { bold: true });
  text(ox + 252, 126, 'Issued 12 Aug 2026 · due 26 Aug 2026', 13, C.muted);
  button(ox + 1010, 88, 'Duplicate', { size: 'md', variant: 'ghost' });
  button(ox + 1140, 88, 'Send again', { size: 'md', variant: 'secondary' });
  button(ox + 1290, 88, 'Record payment', { size: 'md', variant: 'primary' });

  rect(ox + 252, 160, 780, 560, C.white, { stroke: C.border, strokeWidth: 1, label: 'card/lines' });
  text(ox + 276, 184, 'Line items', 14, C.ink, { bold: true });
  rect(ox + 253, 216, 778, 30, C.field);
  [['Description', 276], ['Qty', 640], ['Unit', 730], ['Total', 900]]
    .forEach(([n, x]) => text(ox + x, 224, n.toUpperCase(), 10, C.muted, { bold: true, font: F.mono }));
  [
    ['Pro plan — annual', '1', '$960.00', '$960.00'],
    ['Extra seats (4)', '4', '$48.00', '$192.00'],
    ['Onboarding session', '1', '$88.00', '$88.00'],
  ].forEach(([d, q, u, t], i) => {
    const y = 262 + i * 44;
    if (i > 0) rule(ox + 253, y - 12, 778, C.line);
    text(ox + 276, y, d, 13, C.ink);
    text(ox + 646, y, q, 13, C.body, { font: F.mono });
    text(ox + 730, y, u, 13, C.body, { font: F.mono });
    text(ox + 900, y, t, 13, C.ink, { font: F.mono, bold: true });
  });
  rule(ox + 640, 410, 391, C.border);
  [['Subtotal', '$1,240.00', false], ['VAT (0%)', '$0.00', false], ['Total due', '$1,240.00', true]]
    .forEach(([l, v, strong], i) => {
      const y = 428 + i * 30;
      text(ox + 640, y, l, 13, strong ? C.ink : C.muted, { bold: strong });
      text(ox + 900, y, v, strong ? 15 : 13, C.ink, { bold: strong, font: F.mono });
    });
  text(ox + 276, 560, 'Notes', 11, C.muted, { bold: true, font: F.mono });
  text(ox + 276, 582, 'Thanks for your business. Payment received by card,', 13, C.body, { italic: true });
  text(ox + 276, 604, 'reference NW-2481-AC.', 13, C.body, { italic: true });

  rect(ox + 1060, 160, 356, 260, C.white, { stroke: C.border, strokeWidth: 1, label: 'card/customer' });
  text(ox + 1084, 184, 'Billed to', 14, C.ink, { bold: true });
  circle(ox + 1084, 216, 40, C.barSoft);
  text(ox + 1096, 230, 'AK', 13, C.indigo, { bold: true, font: F.mono });
  text(ox + 1136, 218, 'Ada Keller', 15, C.ink, { bold: true });
  text(ox + 1136, 240, 'Acme Corp', 12, C.muted);
  rule(ox + 1084, 276, 308, C.line);
  [['Email', 'ada@acme.com'], ['VAT', 'GB 123 4567 89'], ['Terms', 'Net 14']]
    .forEach(([k, v], i) => {
      const y = 296 + i * 30;
      text(ox + 1084, y, k, 12, C.muted);
      text(ox + 1200, y, v, 12, C.ink, { font: F.mono });
    });

  rect(ox + 1060, 448, 356, 272, C.white, { stroke: C.border, strokeWidth: 1, label: 'card/timeline' });
  text(ox + 1084, 472, 'Timeline', 14, C.ink, { bold: true });
  [['Paid', '12 Aug, 14:22', C.good], ['Viewed', '12 Aug, 09:04', C.bar], ['Sent', '12 Aug, 08:58', C.faint], ['Created', '11 Aug, 17:30', C.faint]]
    .forEach(([ev, when, dot], i) => {
      const y = 508 + i * 48;
      circle(ox + 1088, y, 10, dot);
      if (i < 3) rect(ox + 1092, y + 12, 1, 36, C.border);
      text(ox + 1112, y - 2, ev, 13, C.ink, { bold: true });
      text(ox + 1112, y + 16, when, 11, C.muted, { font: F.mono });
    });
}

/* ══════════════════════════════════════════════════════════════════════════
   SCREEN 4 — Settings
   ══════════════════════════════════════════════════════════════════════════ */
{
  const ox = screen((SCREEN_W + GUTTER) * 3, '04 Settings');
  topbar(ox, 'Settings');
  sidebar(ox, 5);

  text(ox + 252, 88, 'Settings', 26, C.ink, { bold: true, font: F.display });
  text(ox + 252, 126, 'Workspace, billing and team', 13, C.muted);

  ['General', 'Members', 'Billing', 'Integrations', 'Danger zone'].forEach((t, i) => {
    const x = ox + 252 + i * 122;
    const on = i === 1;
    text(x, 176, t, 13, on ? C.indigo : C.muted, { bold: on });
    if (on) rect(x, 200, t.length * 8, 2, C.indigo, { label: 'tab/underline' });
  });
  rule(ox + 252, 201, 1164, C.border);

  rect(ox + 252, 232, 1164, 220, C.white, { stroke: C.border, strokeWidth: 1, label: 'card/workspace' });
  text(ox + 276, 256, 'Workspace', 14, C.ink, { bold: true });
  text(ox + 276, 278, 'Visible to everyone you invite.', 12, C.muted);
  field(ox + 276, 312, 380, 'NAME', 'Acme Corp');
  field(ox + 692, 312, 380, 'SLUG', 'acme', { placeholder: false });
  field(ox + 276, 390, 380, 'BILLING EMAIL', 'ap@acme.com');
  button(ox + 1240, 400, 'Save changes', { size: 'md', variant: 'primary' });

  rect(ox + 252, 480, 1164, 320, C.white, { stroke: C.border, strokeWidth: 1, label: 'card/members' });
  text(ox + 276, 504, 'Members', 14, C.ink, { bold: true });
  button(ox + 1256, 496, 'Invite people', { size: 'sm', variant: 'secondary' });
  rect(ox + 253, 536, 1162, 30, C.field);
  [['Person', 276], ['Role', 760], ['Last active', 1000], ['', 1300]]
    .forEach(([n, x]) => n && text(ox + x, 544, n.toUpperCase(), 10, C.muted, { bold: true, font: F.mono }));
  [
    ['AK', 'Ada Keller', 'ada@acme.com', 'Owner', 'now', C.barSoft],
    ['JM', 'Jon Moss', 'jon@acme.com', 'Editor', '2h ago', C.goodSoft],
    ['SR', 'Sara Rye', 'sara@acme.com', 'Viewer', 'yesterday', C.badSoft],
    ['TL', 'Tom Lund', 'tom@acme.com', 'Editor', '3d ago', C.chip],
  ].forEach(([ini, name, mail, role, seen, tint], i) => {
    const y = 586 + i * 52;
    if (i > 0) rule(ox + 253, y - 14, 1162, C.line);
    circle(ox + 276, y - 4, 32, tint);
    text(ox + 285, y + 6, ini, 11, C.body, { bold: true, font: F.mono });
    text(ox + 320, y, name, 13, C.ink, { bold: true });
    text(ox + 320, y + 18, mail, 11, C.muted, { font: F.mono });
    rect(ox + 760, y, 76, 22, role === 'Owner' ? C.indigoSoft : C.chip, { label: `chip/${role}` });
    text(ox + 770, y + 4, role, 11, role === 'Owner' ? C.indigo : C.body, { bold: true });
    text(ox + 1000, y + 4, seen, 12, C.muted);
    text(ox + 1300, y + 4, 'Remove', 12, C.bad);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   SCREEN 5 — Design system
   ══════════════════════════════════════════════════════════════════════════ */
{
  const ox = screen((SCREEN_W + GUTTER) * 4, '05 Design system');
  rect(ox, 0, SCREEN_W, SCREEN_H, C.white, { label: 'ds/ground' });
  text(ox + 72, 64, 'Design system', 34, C.ink, { bold: true, font: F.display });
  text(ox + 72, 112, 'Type, colour and controls used across the five screens.', 14, C.muted);
  rule(ox + 72, 150, 1296, C.border);

  /* type scale — three families */
  text(ox + 72, 178, 'TYPE SCALE', 10, C.faint, { bold: true, font: F.mono });
  const scale = [
    ['Display 44 / Georgia', 44, F.display, true],
    ['Display 34 / Georgia', 34, F.display, true],
    ['Heading 26 / Georgia', 26, F.display, true],
    ['Title 20 / sans', 20, F.ui, true],
    ['Body 15 / sans', 15, F.ui, false],
    ['Body 13 / sans', 13, F.ui, false],
    ['Caption 11 / sans', 11, F.ui, false],
    ['Data 13 / mono', 13, F.mono, false],
    ['Label 10 / mono', 10, F.mono, true],
  ];
  let ty = 206;
  scale.forEach(([label, size, font, bold]) => {
    text(ox + 72, ty, label, size, C.ink, { font, bold });
    text(ox + 560, ty + Math.max(0, size - 12), `${size}px`, 10, C.faint, { font: F.mono });
    ty += Math.ceil(size * 1.45) + 10;
  });

  /* colour swatches */
  text(ox + 700, 178, 'COLOUR', 10, C.faint, { bold: true, font: F.mono });
  const swatches = [
    ['indigo/600', C.indigo], ['indigo/700', C.indigoHover], ['indigo/50', C.indigoSoft],
    ['ink/900', C.ink], ['slate/700', C.body], ['slate/500', C.muted],
    ['slate/400', C.faint], ['border', C.border], ['page', C.page],
    ['good/600', C.good], ['warn/700', C.warn], ['bad/600', C.bad],
  ];
  swatches.forEach(([name, hex], i) => {
    const x = ox + 700 + (i % 4) * 168;
    const y = 206 + Math.floor(i / 4) * 92;
    rect(x, y, 152, 52, hex, { stroke: C.border, strokeWidth: 1, label: `swatch/${name}` });
    text(x, y + 58, name, 11, C.body, { font: F.mono });
    text(x, y + 74, hex, 10, C.faint, { font: F.mono });
  });

  /* button matrix: 3 sizes x 4 variants */
  text(ox + 700, 500, 'BUTTONS', 10, C.faint, { bold: true, font: F.mono });
  const variants = ['primary', 'secondary', 'ghost', 'danger'];
  const sizes = ['sm', 'md', 'lg'];
  sizes.forEach((size, r) => {
    text(ox + 700, 534 + r * 62, size.toUpperCase(), 10, C.faint, { font: F.mono });
    let bx = ox + 744;
    variants.forEach((variant) => {
      const w = button(bx, 528 + r * 62, variant === 'danger' ? 'Delete' : 'Continue', { size, variant });
      bx += w + 16;
    });
  });

  /* form controls */
  text(ox + 72, 700, 'CONTROLS', 10, C.faint, { bold: true, font: F.mono });
  field(ox + 72, 726, 260, 'TEXT INPUT', 'ada@acme.com');
  field(ox + 352, 726, 200, 'EMPTY', 'placeholder', { placeholder: true });
  // toggle on / off
  rect(ox + 72, 828, 44, 24, C.indigo, { label: 'toggle/on' });
  circle(ox + 94, 830, 20, C.white);
  text(ox + 126, 832, 'Enabled', 13, C.ink);
  rect(ox + 232, 828, 44, 24, C.border, { label: 'toggle/off' });
  circle(ox + 234, 830, 20, C.white);
  text(ox + 286, 832, 'Disabled', 13, C.muted);
  // chips
  [['Paid', C.goodSoft, C.good], ['Pending', C.warnSoft, C.warn], ['Refunded', C.badSoft, C.bad], ['Draft', C.chip, C.body]]
    .forEach(([label, bg, fg], i) => {
      const x = ox + 700 + i * 96;
      rect(x, 828, 84, 24, bg, { label: `ds/chip-${label}` });
      text(x + 12, 833, label, 11, fg, { bold: true });
    });
}

/* ── write ───────────────────────────────────────────────────────────────── */
const snapshot = {
  version: 1,
  exportedAt: NOW,
  boardName: 'Northwind — starter project',
  boardDescription: 'Five screens and a design system, built entirely in Mero Design.',
  elements: els,
  comments: [
    { id: 'starter-note-1', x: 1720, y: 262, content: 'KPI cards want an 8px corner radius once that lands.', author: '', createdAt: NOW, replies: [] },
    { id: 'starter-note-2', x: 6300, y: 500, content: 'Button matrix is the source of truth — copy from here.', author: '', createdAt: NOW, replies: [] },
  ],
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(snapshot));

const byKind = els.reduce((a, e) => ((a[e.data.kind] = (a[e.data.kind] ?? 0) + 1), a), {});
const fonts = new Set(els.filter((e) => e.data.kind === 'text').map((e) => e.data.fontFamily));
const sizes = new Set(els.filter((e) => e.data.kind === 'text').map((e) => e.data.fontSize));
console.log(`${els.length} elements  ${JSON.stringify(byKind)}`);
console.log(`${fonts.size} font families, ${sizes.size} type sizes, ${snapshot.comments.length} comments`);
console.log(`ids unique: ${new Set(els.map((e) => e.id)).size === els.length}`);
console.log(`layerIndex unique: ${new Set(els.map((e) => e.layerIndex)).size === els.length}`);
console.log(`→ ${OUT} (${(JSON.stringify(snapshot).length / 1024).toFixed(0)} kB)`);
