/**
 * Generates the presentation starter shipped with the app — a deck about
 * Calimero, authored as a MeroDesign board.
 *
 *   node scripts/build-starter-presentation.mjs   →  src/starter/starter-presentation.json
 *
 * Every slide is a screen (see src/utils/screens.ts): a 1920×1080 backdrop rect
 * labelled `screen/<name>`, with its contents laid on top. Slide 7 is 3000px
 * tall on purpose, so the starter shows off a screen that scrolls. The screens
 * carry no order suffix and no number in their names: they play in reading
 * order until someone reorders them, and the Screens tab numbers them live.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src/starter/starter-presentation.json");

const C = {
  bg: "#0B0F17", surface: "#141A26", surface2: "#1B2333", line: "#263045",
  ink: "#F4F6FA", body: "#C3CAD9", muted: "#7D879C",
  lime: "#A3E635", limeSoft: "#1E2B12", blue: "#60A5FA", blueSoft: "#132238",
  violet: "#A78BFA", violetSoft: "#221A3A", amber: "#FBBF24", amberSoft: "#2E2410",
  rose: "#FB7185", roseSoft: "#34161D",
};
const F = { ui: "Arial", display: "Georgia, serif", mono: "Courier New" };

const W = 1920;
const H = 1080;
const GAP_X = 240;
const GAP_Y = 400;
const NOW = 1790000000000;

const els = [];
let z = 0;
let seq = 0;

function el(kind, x, y, width, height, o = {}) {
  seq += 1;
  els.push({
    id: `presentation-${String(seq).padStart(3, "0")}`,
    data: { kind, ...(o.data ?? {}) },
    x: Math.round(x), y: Math.round(y),
    width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)),
    rotation: 0,
    fill: o.fill ?? "transparent",
    stroke: o.stroke ?? "transparent",
    strokeWidth: o.strokeWidth ?? 0,
    opacity: o.opacity ?? 100,
    layerIndex: z++,
    createdBy: "",
    createdAt: NOW,
    updatedAt: NOW,
    label: o.label ?? null,
    ...(o.radius ? { cornerRadius: o.radius } : {}),
  });
}

const rect = (x, y, w, h, fill, o = {}) => el("rect", x, y, w, h, { fill, ...o });
const circle = (x, y, d, fill, o = {}) => el("circle", x, y, d, d, { fill, ...o });
function text(x, y, content, size, fill, o = {}) {
  const lines = content.split("\n");
  const longest = Math.max(...lines.map((l) => l.length));
  const factor = o.font === F.mono ? 0.6 : o.bold ? 0.58 : 0.52;
  el("text", x, y, o.w ?? Math.ceil(longest * size * factor), Math.ceil(lines.length * size * 1.16), {
    fill,
    label: o.label,
    data: {
      content, fontSize: size, fontFamily: o.font ?? F.ui,
      bold: !!o.bold, italic: !!o.italic, text_align: "left", vertical_align: "top",
    },
  });
}
function arrow(x1, y1, x2, y2, colour, width = 4) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  el("arrow", x, y, Math.abs(x2 - x1), Math.abs(y2 - y1), {
    stroke: colour, strokeWidth: width,
    data: { points: `${x1 - x},${y1 - y} ${x2 - x},${y2 - y}` },
  });
}
const rule = (x, y, w, fill = C.line, h = 2) => rect(x, y, w, h, fill);

/** Slide chrome: the backdrop (the screen itself), a kicker and a page number. */
function slide(index, name, { col, row, height = H, kicker, page }) {
  const ox = col * (W + GAP_X);
  const oy = row * (H + GAP_Y);
  rect(ox, oy, W, height, C.bg, { label: `screen/${name}` });
  if (kicker) {
    rect(ox + 120, oy + 110, 36, 6, C.lime, { radius: 3 });
    text(ox + 172, oy + 98, kicker, 22, C.lime, { bold: true, font: F.mono });
  }
  text(ox + 120, oy + height - 90, "CALIMERO", 18, C.muted, { bold: true, font: F.mono });
  if (page) text(ox + W - 180, oy + height - 90, page, 18, C.muted, { font: F.mono });
  return { ox, oy };
}

/* 1 ── Title ──────────────────────────────────────────────────────────────── */
{
  const { ox, oy } = slide(0, "Calimero", { col: 0, row: 0 });
  // A little network motif on the right.
  const nodes = [[1400, 300], [1640, 470], [1380, 640], [1600, 790], [1200, 480]];
  const links = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 0], [4, 2], [1, 2]];
  for (const [a, b] of links) {
    const [ax, ay] = nodes[a];
    const [bx, by] = nodes[b];
    el("line", ox + Math.min(ax, bx), oy + Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay), {
      stroke: C.line, strokeWidth: 3,
      data: { points: `${ax - Math.min(ax, bx)},${ay - Math.min(ay, by)} ${bx - Math.min(ax, bx)},${by - Math.min(ay, by)}` },
    });
  }
  nodes.forEach(([x, y], i) => {
    circle(ox + x - 34, oy + y - 34, 68, i === 0 ? C.lime : C.surface2, { stroke: i === 0 ? C.lime : C.line, strokeWidth: 3 });
  });
  rect(ox + 120, oy + 260, 36, 6, C.lime, { radius: 3 });
  text(ox + 172, oy + 248, "PEER-TO-PEER APPLICATIONS", 22, C.lime, { bold: true, font: F.mono });
  text(ox + 120, oy + 320, "Apps that live on\nyour own nodes.", 104, C.ink, { bold: true, font: F.display });
  text(ox + 120, oy + 600, "Private, collaborative software — with no central\nserver holding your data.", 36, C.body);
  rule(ox + 120, oy + 780, 520);
  text(ox + 120, oy + 810, "This deck is a MeroDesign board — itself a Calimero app.", 24, C.muted);
  text(ox + 120, oy + H - 90, "CALIMERO", 18, C.muted, { bold: true, font: F.mono });
}

/* 2 ── The problem ─────────────────────────────────────────────────────────── */
{
  const { ox, oy } = slide(1, "The problem", { col: 1, row: 0, kicker: "THE PROBLEM", page: "02" });
  text(ox + 120, oy + 170, "Today, the cloud owns your data.", 72, C.ink, { bold: true, font: F.display });
  const cards = [
    ["Custody", "Your documents sit on\nsomeone else's servers.", C.rose, C.roseSoft],
    ["Access", "The provider decides who\ncan read them — and when.", C.amber, C.amberSoft],
    ["Lock-in", "Leaving means exporting —\nif you're allowed to.", C.violet, C.violetSoft],
  ];
  cards.forEach(([title, body, accent, soft], i) => {
    const x = ox + 120 + i * 570;
    const y = oy + 380;
    rect(x, y, 530, 440, C.surface, { radius: 24, stroke: C.line, strokeWidth: 2 });
    circle(x + 48, y + 48, 72, soft);
    text(x + 70, y + 64, String(i + 1), 36, accent, { bold: true, font: F.mono });
    text(x + 48, y + 170, title, 48, C.ink, { bold: true });
    text(x + 48, y + 250, body, 30, C.body);
  });
}

/* 3 ── How it works ────────────────────────────────────────────────────────── */
{
  const { ox, oy } = slide(2, "How it works", { col: 2, row: 0, kicker: "HOW IT WORKS", page: "03" });
  text(ox + 120, oy + 170, "Every member runs a node.", 72, C.ink, { bold: true, font: F.display });
  const pos = [[200, 480], [700, 340], [700, 660]];
  const names = ["You", "Teammate", "Partner"];
  const links = [[0, 1], [1, 2], [2, 0]];
  for (const [a, b] of links) {
    const [ax, ay] = pos[a];
    const [bx, by] = pos[b];
    const x = Math.min(ax, bx) + 110;
    const y = Math.min(ay, by) + 110;
    el("line", ox + x, oy + y, Math.abs(bx - ax), Math.abs(by - ay), {
      stroke: C.lime, strokeWidth: 4, opacity: 70,
      data: { points: `${ax + 110 - x},${ay + 110 - y} ${bx + 110 - x},${by + 110 - y}` },
    });
  }
  pos.forEach(([x, y], i) => {
    circle(ox + x, oy + y, 220, C.surface2, { stroke: C.lime, strokeWidth: 4 });
    text(ox + x + 44, oy + y + 70, "node", 24, C.muted, { font: F.mono });
    text(ox + x + 44, oy + y + 104, names[i], 30, C.ink, { bold: true });
  });
  text(ox + 200, oy + 930, "Sync is peer-to-peer. No server in the middle.", 24, C.lime, { font: F.mono });
  const points = [
    ["The app's state lives on each node", "not in a data centre you don't control."],
    ["Apps are WebAssembly contracts", "written in Rust, run by every node."],
    ["State is built from CRDTs", "so concurrent edits merge with no coordinator."],
    ["Membership is cryptographic", "only invited identities can read or write."],
  ];
  points.forEach(([head, sub], i) => {
    const y = oy + 360 + i * 140;
    rect(ox + 1100, y + 10, 10, 90, C.lime, { radius: 5 });
    text(ox + 1140, y, head, 34, C.ink, { bold: true });
    text(ox + 1140, y + 52, sub, 26, C.body);
  });
}

/* 4 ── Building blocks ─────────────────────────────────────────────────────── */
{
  const { ox, oy } = slide(3, "Building blocks", { col: 3, row: 0, kicker: "THE MODEL", page: "04" });
  text(ox + 120, oy + 170, "Four building blocks.", 72, C.ink, { bold: true, font: F.display });
  const blocks = [
    ["Namespace", "A team or organisation —\nwho you work with.", C.lime, C.limeSoft],
    ["Group", "Who is in, and with\nwhich capabilities.", C.blue, C.blueSoft],
    ["Context", "One running instance —\nthis very board.", C.violet, C.violetSoft],
    ["Application", "The WASM it runs,\npublished to a registry.", C.amber, C.amberSoft],
  ];
  blocks.forEach(([name, body, accent, soft], i) => {
    const x = ox + 120 + i * 430;
    const y = oy + 400;
    rect(x, y, 360, 380, soft, { radius: 24, stroke: accent, strokeWidth: 3 });
    text(x + 36, y + 40, `0${i + 1}`, 26, accent, { bold: true, font: F.mono });
    text(x + 36, y + 110, name, 44, C.ink, { bold: true });
    text(x + 36, y + 190, body, 27, C.body);
    if (i < blocks.length - 1) arrow(x + 372, y + 190, x + 420, y + 190, C.muted, 5);
  });
  text(ox + 120, oy + 850, "A namespace holds groups; a group's members share its contexts; each context runs one application.", 26, C.muted);
}

/* 5 ── Developer experience ────────────────────────────────────────────────── */
{
  const { ox, oy } = slide(4, "For developers", { col: 0, row: 1, kicker: "FOR DEVELOPERS", page: "05" });
  text(ox + 120, oy + 170, "Write the logic. Get the network.", 72, C.ink, { bold: true, font: F.display });
  rect(ox + 120, oy + 330, 1000, 600, C.surface, { radius: 20, stroke: C.line, strokeWidth: 2 });
  [C.rose, C.amber, C.lime].forEach((c, i) => circle(ox + 152 + i * 34, oy + 358, 18, c));
  text(ox + 260, oy + 356, "logic/src/lib.rs", 20, C.muted, { font: F.mono });
  const code = [
    "#[app::state(emits = Event)]",
    "pub struct Board {",
    "    elements: UnorderedMap<String, Element>,",
    "}",
    "",
    "#[app::logic]",
    "impl Board {",
    "    pub fn add_element(&mut self, el: Element) {",
    "        let id = el.id.clone();",
    "        self.elements.insert(id.clone(), el);",
    "        app::emit!(Event::ElementAdded(id));",
    "    }",
    "}",
  ].join("\n");
  text(ox + 160, oy + 420, code, 26, C.body, { font: F.mono });
  const tools = [
    ["cargo mero build", "one command → a signed .mpk bundle"],
    ["mero-js · mero-react", "typed client + hooks for the frontend"],
    ["merobox", "real nodes in CI, not mocks"],
  ];
  tools.forEach(([head, sub], i) => {
    const y = oy + 350 + i * 190;
    rect(ox + 1200, y, 600, 160, C.surface2, { radius: 18 });
    text(ox + 1240, y + 34, head, 32, C.lime, { bold: true, font: F.mono });
    text(ox + 1240, y + 88, sub, 26, C.body);
  });
}

/* 6 ── Ecosystem ───────────────────────────────────────────────────────────── */
{
  const { ox, oy } = slide(5, "Already running", { col: 1, row: 1, kicker: "THE ECOSYSTEM", page: "06" });
  text(ox + 120, oy + 170, "Already running on Calimero.", 72, C.ink, { bold: true, font: F.display });
  const apps = [
    ["MeroDesign", "Collaborative canvas", C.lime],
    ["MeroSign", "Sign agreements", C.blue],
    ["MeroDrive", "Shared documents", C.violet],
    ["MeroPass", "Team password vault", C.amber],
    ["MeroCalendar", "Shared calendars", C.rose],
    ["MeroSheets", "Spreadsheets", C.lime],
    ["MeroForum", "Discussions", C.blue],
    ["Battleships", "A two-player game", C.violet],
  ];
  apps.forEach(([name, sub, accent], i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = ox + 120 + col * 430;
    const y = oy + 360 + row * 260;
    rect(x, y, 400, 220, C.surface, { radius: 20, stroke: C.line, strokeWidth: 2 });
    rect(x + 36, y + 40, 56, 56, accent, { radius: 14 });
    text(x + 36, y + 120, name, 34, C.ink, { bold: true });
    text(x + 36, y + 166, sub, 24, C.muted);
  });
  text(ox + 120, oy + 900, "Each one: your data on your nodes, shared only with who you invite.", 26, C.body);
}

/* 7 ── One edit, end to end (a TALL screen: it scrolls) ────────────────────── */
{
  const TALL = 3000;
  const { ox, oy } = slide(6, "One edit, end to end", { col: 2, row: 1, height: TALL, kicker: "UNDER THE HOOD", page: "07" });
  text(ox + 120, oy + 170, "One edit, end to end.", 72, C.ink, { bold: true, font: F.display });
  text(ox + 120, oy + 280, "A tall screen — scroll, or press Space.", 30, C.muted);
  const steps = [
    ["You move a shape", "The canvas calls update_element on your own node,\nover JSON-RPC. Nothing leaves your machine yet."],
    ["Your node runs the contract", "The WASM checks your role, then writes the change\ninto CRDT state — a signed, mergeable delta."],
    ["The delta goes to your peers", "Broadcast over the context's peer-to-peer topic,\nencrypted for its members only."],
    ["Every peer merges it", "CRDTs converge: the same result on every node,\nwhatever order the edits arrive in."],
    ["Open apps repaint", "Each node streams the event to its frontend;\nyour teammate sees the shape move."],
    ["Offline? It catches up", "A node that was away syncs the missing deltas\nwhen it reconnects. No server to wait for."],
  ];
  const top = oy + 470;
  const step = 400;
  rect(ox + 186, top + 60, 8, step * (steps.length - 1), C.line, { radius: 4 });
  steps.forEach(([head, body], i) => {
    const y = top + i * step;
    circle(ox + 130, y, 120, i === steps.length - 1 ? C.lime : C.surface2, { stroke: C.lime, strokeWidth: 4 });
    text(ox + 172, y + 34, String(i + 1), 48, i === steps.length - 1 ? C.bg : C.lime, { bold: true, font: F.mono });
    rect(ox + 320, y - 10, 1480, 300, C.surface, { radius: 22, stroke: C.line, strokeWidth: 2 });
    text(ox + 370, y + 40, head, 44, C.ink, { bold: true });
    text(ox + 370, y + 120, body, 30, C.body);
  });
}

/* 8 ── Close ───────────────────────────────────────────────────────────────── */
{
  // Row 2, so it plays after the tall screen (reading order: row by row).
  const { ox, oy } = slide(7, "Get started", { col: 0, row: 2, page: "08" });
  rect(ox + 120, oy + 260, 36, 6, C.lime, { radius: 3 });
  text(ox + 172, oy + 248, "GET STARTED", 22, C.lime, { bold: true, font: F.mono });
  text(ox + 120, oy + 320, "Your data. Your nodes.\nYour apps.", 104, C.ink, { bold: true, font: F.display });
  rule(ox + 120, oy + 640, 520);
  text(ox + 120, oy + 690, "calimero.network", 40, C.lime, { bold: true, font: F.mono });
  text(ox + 120, oy + 760, "github.com/calimero-network", 32, C.body, { font: F.mono });
}

const snapshot = {
  version: 1,
  exportedAt: NOW,
  boardName: "Calimero presentation",
  boardDescription: "A presentation built as a MeroDesign board: 8 screens, one of them tall.",
  elements: els,
  comments: [],
};
writeFileSync(OUT, JSON.stringify(snapshot));
console.log(`${els.length} elements → ${OUT}`);
