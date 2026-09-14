/**
 * Per-app landing content for all fourteen user-facing apps.
 *
 * This is the ONLY place app-specific copy lives. `generate.mjs` renders each
 * entry into `apps/<app>/app/src/pages/landing/landing.config.ts` next to a
 * byte-identical copy of the template, and `check.mjs` fails CI if either
 * drifts.
 *
 * `packageId` and `tagline` are NOT written here — they are read from each
 * app's `[package.metadata.calimero]` table at generate time. Everything below
 * is what the TOML does not carry.
 *
 * `displayName` is the one deliberate exception. Five apps spell their name
 * closed-up or off-pattern in the registry (`MeroDesign`, `MeroPass`,
 * `MeroPixArt`, `P2P Sheets`, `MeroSign`) and every app should read the same
 * way, so the spaced spelling is used wherever a PERSON sees the name — this
 * landing page, and the app's own `<title>`, PWA manifest, navbar brand and
 * copy, which were standardised to match.
 *
 * ⚠️ It is a PRESENTATION choice and it stops at the frontend. The Cargo
 * `[package.metadata.calimero]` tables are left EXACTLY as published — the
 * registry still lists `MeroDesign`, `MeroPass`, `MeroPixArt`, `P2P Sheets`
 * and `MeroSign`, and the package ids, slugs and bundles are untouched. Nothing
 * in a published `.mpk`, an installed copy or an invite link moves. Generated
 * client classes (`MeroPassClient`) and log prefixes keep their old spelling
 * too: they are identifiers, not the product name.
 *
 * Omit it and the page uses the metadata name verbatim.
 *
 * `icon` values are named exports of `@calimero-network/mero-icons`. No emoji:
 * an emoji is a fixed-colour bitmap that cannot follow the dark palette.
 *
 * ── NOT GENERATED, and why ────────────────────────────────────────────────
 * `kv-store`      contract/test fixture, no user-facing frontend.
 * `scaffolding-e2e`  e2e harness app, same.
 *
 * `mero-blocks` and `merraria` ARE included, but they need one extra piece.
 * Neither is a React app — both boot from `src/main.ts` with no `.tsx` — and
 * their `Landing` (`src/ui/landing.ts`) is an imperative launcher resolving a
 * `LaunchChoice` promise `main.ts` awaits before the game starts. Rather than
 * rewrite that, the marketing page sits IN FRONT of it: a hand-written
 * `mount.tsx` renders this template into a throwaway root and resolves when the
 * CTA is clicked, then hands off to the launcher untouched. It is skipped for
 * an `?invitation=` link and after the first view in a session, so joining a
 * world and coming back to play never pay for it.
 */

import { DOCS } from './docs.config.mjs';

/** @type {Record<string, import('./types.js').AppLanding>} */
export const APPS = {
  battleships: {
    e2eDir: 'e2e',
    availability: 'web+desktop',
    trust: ['Boards never leave your node', 'Commit-reveal placement', 'No accounts'],
    explainer: [
      'Turn-based Battleships for two players, where the interesting part is not the game — it is the trust model. Your fleet lives in private, node-local storage, so your opponent’s node never holds a copy of it at any point.',
      'Placement is commit-reveal: you commit to a board up front and reveal it at the end, so neither side can quietly move a ship after seeing where the shots are going. A lobby service handles matchmaking and a separate game service runs each match.',
    ],
    features: [
      { icon: 'EyeOff', title: 'A board your opponent cannot read', body: 'Ships live in `#[app::private]` storage that never replicates. There is no copy on their node to inspect.' },
      { icon: 'LockCheck', title: 'Commit-reveal placement', body: 'You commit to a fleet before play and reveal it after. Neither player can change their board mid-game.' },
      { icon: 'Target', title: 'Matchmaking without a server', body: 'A lobby service pairs players and a game service runs each match, both inside the same bundle.' },
      { icon: 'ArrowUpRight', title: 'Results reported back', body: 'A finished match tells the lobby who won through a cross-context call, so history survives the game.' },
      { icon: 'ExternalLink', title: 'Invite by link', body: 'Recursive namespace invitations. No sign-up, no account, no email address.' },
    ],
  },


  'mero-blocks': {
    // Keeps its own sign-in — a sidebar, or the game launcher — so the
    // landing gets an onConnect callback and never mounts the shared popup.
    ownConnect: true,
    e2eDir: 'e2e',
    availability: 'web+desktop',
    playableOffline: true,
    trust: ['No game server', 'Deterministic world', 'Plays offline'],
    explainer: [
      'A Minecraft-style voxel sandbox you can build in with other people, hosted by nobody. The world is not a server you connect to — it is a Calimero context holding a seed plus the diff of every block anyone has edited.',
      'Because the terrain generator is deterministic, the same seed and the same diff produce the same world on every peer, so all that has to replicate is the edits. And if you just want to dig around on your own, it runs with no node at all.',
    ],
    features: [
      { icon: 'CloudX', title: 'No game server', body: 'The world is a seed plus a block-edit diff, in a context you own. Nothing to host, nothing to pay for.' },
      { icon: 'WifiOff', title: 'Plays fully offline', body: 'No node required. The world persists to localStorage and is yours alone until you want company.' },
      { icon: 'Cube3DStacked', title: 'Deterministic terrain', body: 'The same seed builds the same world on every peer, so only the edits need to travel.' },
      { icon: 'Wifi', title: 'See other players', body: 'Presence replicates alongside the edits, so you watch people build in real time.' },
      { icon: 'Monitor', title: 'Runs in a browser', body: 'A Three.js renderer over a pure-TypeScript engine. Nothing to install to start playing.' },
    ],
  },

  merraria: {
    // Keeps its own sign-in — a sidebar, or the game launcher — so the
    // landing gets an onConnect callback and never mounts the shared popup.
    ownConnect: true,
    e2eDir: 'e2e',
    availability: 'web+desktop',
    playableOffline: true,
    trust: ['No game server', 'Deterministic world', 'Plays offline'],
    explainer: [
      'A Terraria-style mining and building sandbox, seen from the side, shared with other players and hosted by nobody. Like Mero Blocks, the world is a Calimero context: a seed, the diff of every tile anyone has changed, and player presence.',
      'The terrain generator is deterministic, so the seed plus the edits reproduce the same world everywhere and only the edits have to travel. It also runs with no node at all if you want to dig alone.',
    ],
    features: [
      { icon: 'CloudX', title: 'No game server', body: 'The world is a seed plus a tile-edit diff, in a context you own. Nothing to host.' },
      { icon: 'WifiOff', title: 'Plays fully offline', body: 'No node needed. The world persists locally and is yours until you invite anyone.' },
      { icon: 'Cube3DStacked', title: 'Deterministic terrain', body: 'The same seed builds the same world on every peer, so only your changes replicate.' },
      { icon: 'Wifi', title: 'See other players', body: 'Presence rides alongside the tile edits, so you watch people mine in real time.' },
      { icon: 'Monitor', title: 'Runs in a browser', body: 'A Canvas2D renderer over a pure-TypeScript engine. Nothing to install.' },
    ],
  },

  'mero-calendar': {
    e2eDir: 'e2e',
    // This app ships its own light/dark switch; the landing toggle writes the
    // same key so the choice carries through sign-in instead of resetting.
    themeStorageKey: 'mc-theme',
    availability: 'web+desktop',
    trust: ['Teams are namespaces', 'Private events never sync', 'Light and dark'],
    explainer: [
      'A shared calendar for a team that does not want its schedule sitting in someone else’s cloud. A team is a Calimero namespace, so the people in it are exactly the people you invited, and the calendar lives on their nodes and yours.',
      'Shared events are owner-gated, so a member sees what they own or were invited to rather than everything. Private events use node-local storage and never replicate at all — they exist on your machine and nowhere else.',
    ],
    features: [
      { icon: 'Grid', title: 'Teams are namespaces', body: 'Everyone in the namespace syncs the same calendar. Membership is the access model.' },
      { icon: 'Shield', title: 'Owner-gated shared events', body: 'Members see events they own or were invited to, not the whole team’s diary by default.' },
      { icon: 'EyeOff', title: 'Genuinely private events', body: 'Node-local storage that never replicates. Not "private" as a flag on a shared record.' },
      { icon: 'Moon', title: 'Light and dark themes', body: 'With an accessible palette, because a calendar is something people stare at all day.' },
      { icon: 'HeartCheck', title: 'Readable identities', body: 'Display names instead of key hashes, so a shared calendar reads like one.' },
    ],
  },

  'mero-design': {
    displayName: 'Mero Design',
    e2eDir: 'e2e',
    availability: 'web+desktop',
    trust: ['Infinite canvas', 'Real-time sync', 'Files on your nodes'],
    explainer: [
      'A collaborative design tool in the shape of Figma — an infinite canvas with shapes, text and images that several people can work on at once. The difference is where the file lives: in a Calimero context on your infrastructure, shared only with the teammates you invite.',
      'There is no central server holding your designs, which means no vendor with a copy, no seat-based access model, and nothing to migrate off if you change your mind.',
    ],
    features: [
      { icon: 'Grid', title: 'Infinite canvas', body: 'Pan and zoom, with multi-select and grouping. Frames and groups ride the same element model.' },
      { icon: 'Cube', title: 'A full shape set', body: 'Rectangles, circles, lines, arrows and freehand paths, with fill, stroke and corner controls.' },
      { icon: 'CloudUpload', title: 'Images and SVGs', body: 'Dropped straight onto the canvas and stored as blobs on your node, not on a CDN.' },
      { icon: 'FileText', title: 'Text with font controls', body: 'Real text elements with family, size and weight, not shapes that happen to look like words.' },
      { icon: 'Download', title: 'Export to PNG or SVG', body: 'Your work leaves in a format anything can open. No lock-in on the way out.' },
      { icon: 'Refresh', title: 'Real-time sync', body: 'Changes stream to every member over SSE. No central server arbitrating who edited what.' },
    ],
  },

  'mero-drive': {
    markSrc: '/icons/icon.svg',
    // Nested, because this app's playwright config gives its node-free specs
    // their own project globbed as `**/landing/**` — a spec written beside that
    // directory rather than inside it is collected by no project and never runs.
    e2eDir: 'e2e/landing',
    availability: 'web+desktop',
    trust: ['Folders are contexts', 'Rich-text editing', 'Private by default'],
    explainer: [
      'A document workspace — folders, rich-text documents, and the tags you need to find them again six months later. Built as a multi-service bundle: a registry service holds the folder tree for a namespace, and each folder is its own context holding its documents.',
      'That structure is the point. A folder’s documents replicate only to the people who have that folder, so sharing one project does not hand over the whole workspace.',
    ],
    features: [
      { icon: 'Folder', title: 'Folders are contexts', body: 'Each folder’s documents live in their own context, so access is per folder rather than all-or-nothing.' },
      { icon: 'FileText', title: 'Rich-text documents', body: 'A real editor with formatting, headings and lists, syncing as you type.' },
      { icon: 'Table', title: 'Tags and archive', body: 'Organise by tag and retire what is finished without deleting anything.' },
      { icon: 'Shield', title: 'Namespace-scoped', body: 'The workspace is a namespace you control. Membership is how access works.' },
      { icon: 'Eye', title: 'Per-folder visibility', body: 'Decide what is shared and what stays yours, folder by folder.' },
    ],
  },

  'mero-forum': {
    e2eDir: 'tests',
    availability: 'web+desktop',
    trust: ['Invite-only threads', 'No feed ranking', 'Replicated peer-to-peer'],
    explainer: [
      'A discussion forum for a group that wants threads without a platform. Posts and comments live in a Calimero context shared by its members, replicated between their own nodes.',
      'There is no operator to rank your feed, sell against it, or change the rules — the members of the namespace are the whole system. It is the shape a mailing list would have if it were designed now.',
    ],
    features: [
      { icon: 'MessageCircle', title: 'Threads and comments', body: 'Post, reply, and follow a conversation, replicated across every member’s node.' },
      { icon: 'Shield', title: 'Members are the namespace', body: 'Invite-only by construction. There is no public firehose and no lurking stranger.' },
      { icon: 'CloudX', title: 'No platform in the middle', body: 'Nothing ranks your feed, nothing advertises against it, and no account is required.' },
      { icon: 'Refresh', title: 'Real-time', body: 'New posts and replies appear as peers sync, without a refresh button.' },
    ],
  },

  'mero-issue-tracker': {
    e2eDir: 'e2e',
    // This app ships its own light/dark switch; the landing toggle writes the
    // same key so the choice carries through sign-in instead of resetting.
    themeStorageKey: 'app:theme',
    availability: 'web+desktop',
    trust: ['Structured issues', 'MCP server included', 'Private to your team'],
    explainer: [
      'A real-time issue board for a small engineering team. Issues are structured around what actually makes a bug actionable — a summary, who it affects, how to reproduce it, and what "fixed" has to satisfy — rather than a free-text box and a pile of labels.',
      'It also ships an MCP server, so an AI coding agent can pull an issue with its full context and hand you back a fix. The board is private to your namespace, not a tenant in someone else’s SaaS.',
    ],
    features: [
      { icon: 'FileCheck', title: 'Structured issues', body: 'Summary, impact, reproduction steps and resolution criteria — the four things that make a bug fixable.' },
      { icon: 'Refresh', title: 'Real-time board', body: 'Triage together. Status moves and comments land on every member’s node as they happen.' },
      { icon: 'Zap', title: 'Copy fix prompt', body: 'Render any issue as a prompt for a coding agent, with its context attached, in one click.' },
      { icon: 'Package', title: 'MCP server', body: 'Expose the board to an AI agent over Model Context Protocol, so it can read issues directly.' },
      { icon: 'Shield', title: 'Private to your team', body: 'A namespace you own, not a workspace in a product that reserves the right to read it.' },
    ],
  },

  'mero-meet': {
    e2eDir: 'tests',
    // This app ships its own light/dark switch; the landing toggle writes the
    // same key so the choice carries through sign-in instead of resetting.
    themeStorageKey: 'mm-theme',
    availability: 'desktop',
    trust: ['Media stays peer-to-peer', 'No signalling server', 'Rooms are namespaces'],
    explainer: [
      'Peer-to-peer video calling, split across two planes. A Calimero context is the room and carries the signalling; the audio and video go directly between participants over WebRTC and never touch a server at all.',
      'The signalling is the part other "peer-to-peer" calling apps still centralise — someone has to introduce the peers to each other, and that someone usually gets to see who called whom and when. Here the introduction rides your own nodes.',
    ],
    features: [
      { icon: 'Wifi', title: 'Media stays peer-to-peer', body: 'WebRTC between participants. Your camera and microphone never reach a server.' },
      { icon: 'Shield', title: 'Signalling rides your nodes', body: 'The room is a context you own, not a service you rent. Nobody logs the call graph.' },
      { icon: 'CloudX', title: 'No signalling server', body: 'The piece almost every other p2p calling app still centralises, removed.' },
      { icon: 'ExternalLink', title: 'Invite by link', body: 'The room is a namespace. Share an invitation, and membership is the access control.' },
    ],
    faq: [
      {
        q: 'Why does this need the desktop app?',
        a: 'Mero Meet uses the Calimero desktop app for its node, its sign-in, and the media bridge that connects WebRTC to the room. On the plain web there is no node to talk to, so this page is the front door rather than the app itself.',
      },
    ],
  },

  'mero-pass': {
    displayName: 'Mero Pass',
    e2eDir: 'tests',
    availability: 'web+desktop',
    trust: ['Vault on your nodes', 'Five secret types', 'No vendor to breach'],
    explainer: [
      'A secret manager for a team, where the vault sits on your own nodes rather than in a company whose breach notification you will read about later. You create a vault, invite the people who need it, and the contents replicate only between their nodes and yours.',
      'It handles the five things teams actually share: logins, notes, one-time-password seeds, SSH keys, and free-form secrets — with roles, so not everyone who can read a vault can change who else does.',
    ],
    features: [
      { icon: 'LockBox', title: 'Vaults with roles', body: 'Owner, admin and member. Reading a vault and controlling its membership are different powers.' },
      { icon: 'LockStar', title: 'Five secret types', body: 'Logins with URLs, secure notes, TOTP seeds, SSH keypairs, and free-form entries.' },
      { icon: 'Clock', title: 'TOTP codes', body: 'Time-based one-time passwords generated locally from a seed that never leaves your nodes.' },
      { icon: 'ShieldCheck', title: 'Share with members', body: 'Scoped to the people you invited. Revoking access is something you do, not request.' },
      { icon: 'CloudX', title: 'No vendor to breach', body: 'There is no central vault to attack, because there is no central vault.' },
    ],
  },

  'mero-pixart': {
    displayName: 'Mero PixArt',
    e2eDir: 'e2e',
    availability: 'web+desktop',
    trust: ['Non-destructive edits', 'Real layer folders', 'Pixels on your nodes'],
    explainer: [
      'A collaborative raster image editor with the depth of a desktop tool — layer folders, masks, blend modes, curves and a corner-pin warp — that several people can work in at the same time.',
      'Adjustments are non-destructive and applied live, so you can reconsider an exposure change a week later. The project, including every uploaded image, lives as blobs on your node rather than in a cloud editor’s bucket.',
    ],
    features: [
      { icon: 'Cube3DLayers', title: 'Layers and folders', body: 'Raster, text and fill layers inside real collapsible folders, not a flat list pretending to nest.' },
      { icon: 'Zap', title: 'Non-destructive adjustments', body: 'Brightness, contrast, saturation, hue, exposure, blur and invert, applied live and always reversible.' },
      { icon: 'LineChart', title: 'Curves', body: 'A per-channel RGB spline editor applied through a lookup table, the way a real editor does it.' },
      { icon: 'Eye', title: 'Blend modes and masks', body: 'All sixteen blend modes, per-layer opacity, and paintable masks to hide or reveal.' },
      { icon: 'Cube3D', title: 'Free transform', body: 'Move, scale, rotate, shear, mirror, and a corner-pin warp for perspective.' },
      { icon: 'Circle', title: 'Paint tools', body: 'Brush, eraser, bucket fill and eyedropper, each re-rendering the layer to a new blob.' },
    ],
  },

  'mero-sheets': {
    displayName: 'Mero Sheets',
    e2eDir: 'e2e',
    // This app ships its own light/dark switch; the landing toggle writes the
    // same key so the choice carries through sign-in instead of resetting.
    themeStorageKey: 'app:theme',
    availability: 'web+desktop',
    trust: ['Live cursors', 'Formulas recompute for all peers', 'Sheet on your node'],
    explainer: [
      'A collaborative spreadsheet where you can see everyone’s cursor and nobody can see your data except the people you invited. The sheet lives in a Calimero context on your own node.',
      'Formulas are stored raw and re-evaluated for every peer whenever a cell they reference changes, so nobody is looking at a stale total — which is the failure that makes shared spreadsheets untrustworthy in the first place.',
    ],
    features: [
      { icon: 'Lock', title: 'Truly private sheets', body: 'The data lives in a context you control. It never passes through a central server.' },
      { icon: 'Zap', title: 'Live cursors', body: 'Every collaborator in their own colour, so you can see who is about to overwrite what.' },
      { icon: 'BarChart', title: 'Formulas that always compute', body: 'SUM, AVERAGE, MIN, MAX, COUNT and IF, re-evaluated per peer whenever a referenced cell changes.' },
      { icon: 'Table', title: 'Multiple sheet tabs', body: 'Split a workbook the way you would expect, with tabs that sync like everything else.' },
      { icon: 'FileText', title: 'Formula autocomplete', body: 'With a built-in function reference, so you do not have to remember the argument order.' },
      { icon: 'Download', title: 'Download your data', body: 'Export whenever you want. Nothing here is designed to keep your numbers hostage.' },
    ],
  },

  'mero-sign': {
    // Keeps its own sign-in — a sidebar, or the game launcher — so the
    // landing gets an onConnect callback and never mounts the shared popup.
    ownConnect: true,
    displayName: 'Mero Sign',
    e2eDir: 'tests',
    availability: 'web+desktop',
    trust: ['No signing service', 'Roles per signatory', 'Verify peer-to-peer'],
    explainer: [
      'Upload a PDF, collect signatures from the people you invite, and verify them — with no e-signature company in the middle holding your contracts and charging per envelope.',
      'An agreement is a shared context you administer. Signatories join by invitation and sign in the roles you assigned them, and your own signature library stays in a private context that only you can read.',
    ],
    features: [
      { icon: 'FileCheck', title: 'Agreements as contexts', body: 'Create one and you administer it. Membership and roles are yours to set.' },
      { icon: 'ShieldCheck', title: 'Role-based signing', body: 'Each signatory signs in the role you assigned, so the document knows who still owes a signature.' },
      { icon: 'LockBox', title: 'A private signature library', body: 'Your signatures live in a local context only you can read, not in a vendor’s account.' },
      { icon: 'ExternalLink', title: 'Invitations tied to identities', body: 'Scoped invite payloads with permissions, bound to Calimero identities rather than email addresses.' },
      { icon: 'GlobeCheck', title: 'Verify peer-to-peer', body: 'Check a signature without asking a service whether it is genuine.' },
    ],
  },

  'mero-stream': {
    e2eDir: 'tests',
    availability: 'web',
    experimental: true,
    trust: ['Measured, not promised', 'Deterministic codec', 'Web only'],
    explainer: [
      'An honest experiment rather than a finished product: how far can the Calimero network carry live video? Mero Stream exists to find the ceiling and report it, and the number it produces is the point.',
      'There are two paths. One runs a deliberately simple integer-only codec inside the WASM app itself; the other stores browser-encoded H.264 fragments and treats the network as transport. Comparing them is what makes the limit legible.',
    ],
    features: [
      { icon: 'ArrowsUpDown', title: 'Two codec paths', body: 'A deterministic codec inside the WASM app, or browser WebCodecs H.264 through the same context.' },
      { icon: 'BarChart', title: 'Measured, not promised', body: 'Built to find the real capacity ceiling and report it, rather than to claim one.' },
      { icon: 'CheckSquare', title: 'Deterministic by construction', body: 'Integer-only, with no float, no SIMD and no threads, so every peer decodes identically.' },
      { icon: 'Trash', title: 'Delete is a tombstone', body: 'Fragment keys are monotone and never reused, so a deletion cannot be confused with a gap.' },
    ],
    faq: [
      {
        q: 'Is this production-ready?',
        a: 'No, and it does not claim to be. Mero Stream is a capacity probe: it exists to measure how much live media a Calimero context can carry. Treat its numbers as findings, not guarantees.',
      },
      {
        q: 'Why web only?',
        a: 'Not because it breaks on the desktop — it renders and runs there. What is unsupported is the desktop integration around it, so anything you see in a desktop window should be reproduced in a browser before it is believed.',
      },
    ],
  },

};

/**
 * The `/docs` and `/preview` copy is long enough to be its own file, but it is
 * still one entry per app: merged in here so `generate.mjs` reads a single
 * table and a missing entry is a loud failure rather than a page that renders
 * with no documentation on it.
 */
for (const [app, entry] of Object.entries(APPS)) {
  const extra = DOCS[app];
  if (!extra) throw new Error(`landing: no docs.config.mjs entry for ${app}`);
  Object.assign(entry, extra);
}
