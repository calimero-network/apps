/**
 * The `/docs` page for each of the fourteen apps, and the captions for `/preview`.
 *
 * Split out of `apps.config.mjs` only for length — `apps.config.mjs` merges this
 * in, so there is still one entry per app and one generator reading it.
 *
 * ── How this was written, because it matters for keeping it true ──────────
 * Every `concepts` row and every storage claim below was read off the app's own
 * `#[app::state]` struct and its `#[app::logic]` methods, not off a README and
 * not from memory. Where a doc says "stored in a map keyed by …", that map is
 * in the contract. That is the part most likely to rot, so when a contract
 * changes, this is the file that changes with it.
 *
 * The three things a per-app doc can say that the platform docs cannot:
 *   1. what Calimero's nouns MEAN here — a namespace is a vault, a board, a
 *      world, a match. This is the single hardest thing for a newcomer.
 *   2. what this app actually writes down, and what it deliberately does not.
 *   3. what to do when the screen disagrees with the other person's screen.
 */

/** Shared by every app: the answer is the same and it should read the same. */
const OFFLINE = {
  id: 'offline',
  heading: 'Offline, and what happens when you reconnect',
  paragraphs: [
    'Your node holds the whole state, so the app keeps working with no network — every change is written locally and queued.',
    'When your node reaches a peer again, the two exchange changes and merge them. Merging is CRDT-based, not last-write-wins-by-clock, so two people editing different things at the same time both keep their work. Where two people genuinely changed the same single value, the later write wins on that one value and nothing else is lost.',
  ],
};

export const DOCS = {
  battleships: {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'Battleships is two Calimero applications in one bundle: a lobby that pairs players and keeps the record, and a game that runs a single match. They talk to each other with a cross-context call rather than sharing state.',
        ],
        concepts: [
          { term: 'Namespace', def: 'A lobby. You create one, invite the people you want to play against, and every match you play together is recorded in it.' },
          { term: 'Context', def: 'One match. It is created when a game starts and holds only that game — the shots fired, whose turn it is, and the result.' },
          { term: 'Private storage', def: 'Where your fleet lives. Declared `#[app::private]`, which means it is never replicated: your opponent’s node has no copy of your board to inspect, at any point in the game.' },
          { term: 'Commit-reveal', def: 'You commit to a board layout before the first shot and reveal it at the end. The commitment is what stops either side quietly moving a ship after seeing where the shots land.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Connect a node', body: 'Press Connect to node. The Calimero desktop app bundles one; if you run your own, enter its URL in the same popup.' },
          { title: 'Create or join a lobby', body: 'A new lobby is a namespace you own. Joining someone else’s means opening their invite link.' },
          { title: 'Place your fleet', body: 'Drag ships onto your grid. This is written to private storage on your own node and committed before play begins.' },
          { title: 'Take turns', body: 'Fire at a square; the result comes back as a hit or a miss. The match ends when one fleet is gone, and the lobby records who won.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Playing with someone else',
        paragraphs: [
          'Invitations are links, scoped to the lobby you created. There is no account, no email address and no sign-up: opening the link and connecting a node is the whole of joining.',
          'An invitation carries the namespace and the permissions it grants. Because it is recursive, a player you invite to the lobby can be added to the matches inside it without a second invitation for each game.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'The lobby stores a map of matches, a per-player win/loss record, and a history of finished matches. All of it replicates to lobby members.',
          'Each match stores its own shots and turn order in its own context, and nothing else.',
          'Your fleet placement is private, node-local, and never replicated. It is the one thing in the app the other player’s node cannot hold.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'The opponent’s shots are not arriving', def: 'Both nodes must be reachable to each other. Check the connection indicator; on two nodes on one machine, confirm they were started with peer discovery enabled.' },
          { term: 'The invite link does nothing', def: 'An invitation is tied to the lobby that minted it and expires. Ask for a fresh one rather than reusing an old link.' },
          { term: 'You cannot see the other player’s board', def: 'That is the design, not a fault. It is revealed at the end of the match.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'Two grids, one private', body: 'Your fleet on the left, their water on the right. Yours is drawn from node-local storage that never replicates.' },
      { title: 'A shot is taken', body: 'Firing writes to the match context. Both nodes converge on the same grid without a referee deciding who shot first.' },
      { title: 'Hit or miss comes back', body: 'The result is derived from the committed board, so it cannot be fudged after the fact.' },
      { title: 'The lobby records it', body: 'When a fleet is gone, the match reports the result back to the lobby as a cross-context call.' },
    ],
  },

  'mero-blocks': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'A voxel world is not stored as a world. It is stored as a seed plus the list of blocks somebody changed — which is why an entire shared world fits in a context and needs no game server.',
        ],
        concepts: [
          { term: 'Namespace', def: 'A world you own. Invite people into it and they build in the same world.' },
          { term: 'Seed', def: 'A single number. Terrain is generated from it deterministically, so every player computes an identical world without anyone sending terrain over the network.' },
          { term: 'Override', def: 'One changed block, keyed by its coordinates. Placing or breaking a block writes an override; the map of overrides is the only terrain data that ever syncs.' },
          { term: 'Presence', def: 'Where other players are right now. Kept in a players map refreshed by a heartbeat, and deliberately not part of the world itself.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Play offline first, if you like', body: 'The game runs with no node at all, persisting to your browser. Nothing is shared, and nothing needs setting up.' },
          { title: 'Connect a node', body: 'Press Connect to node to move from a local world to a shared one.' },
          { title: 'Create a world', body: 'Pick a name. You get a seed, and the world is yours — you are its owner.' },
          { title: 'Invite people', body: 'Share the link. Their client generates the same terrain from the seed and then applies your overrides.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Building together',
        paragraphs: [
          'Edits are batched: a burst of placements goes to the contract as one call rather than one call per block, which is what keeps a building session from flooding the network.',
          'Because overrides are keyed by coordinate, two players changing different blocks never conflict. Two players changing the same block converge on one of the two, and both then see the same thing.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'The world name, the seed, and the creation time.',
          'A map of block overrides, keyed "x,y,z". Breaking a block is recorded as an override too, never as a deletion, so a break cannot be lost to a concurrent edit.',
          'A players map with each player’s position, refreshed by heartbeat and cleaned up when they leave.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'Your terrain differs from theirs', def: 'Terrain comes from the seed, so a mismatch means you are in different worlds — check you both opened the same invite link.' },
          { term: 'A block came back after you broke it', def: 'A break is an override like any other. If someone placed a block there concurrently, one of the two wins; break it again.' },
          { term: 'Other players are not moving', def: 'Presence is heartbeat-driven and separate from the world. Losing presence does not lose your build.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'Terrain from a seed', body: 'No terrain is transmitted. Both machines generate the same world from the same number.' },
      { title: 'A block is placed', body: 'The change is stored as one override keyed by coordinate, batched with any others in the same burst.' },
      { title: 'A peer appears', body: 'Presence arrives separately from the world, so someone joining never rewrites what you built.' },
      { title: 'Both worlds agree', body: 'Seed plus overrides is the whole world. There is no server holding the authoritative copy.' },
    ],
  },

  'mero-calendar': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'Mero Calendar is unusual among these apps in holding two kinds of event with genuinely different privacy, in the same screen.',
        ],
        concepts: [
          { term: 'Namespace', def: 'A team. The people in it are the people who can be invited to events.' },
          { term: 'Context', def: 'The team’s shared calendar. One per team.' },
          { term: 'Shared event', def: 'An event in replicated state, owned by whoever created it. Reads are gated in the contract: you see an event only if you own it or were invited to it.' },
          { term: 'Private event', def: 'An event declared `#[app::private]`. It is stored on your node only and is never replicated to anyone — not even to other members of the team.' },
          { term: 'Username', def: 'A display name you set, so the UI shows people rather than public keys. Last-writer-wins on its own clock.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Connect a node', body: 'Press Connect to node and pick the node the popup discovers, or enter a URL.' },
          { title: 'Create a team', body: 'A team is a namespace you own, with one calendar inside it.' },
          { title: 'Set your name', body: 'Set a username so your teammates see a name instead of a key.' },
          { title: 'Create an event', body: 'Choose shared or private when you create it. Shared events can be given invitees; private ones cannot, because they never leave your node.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Inviting people',
        paragraphs: [
          'Joining a team is an invite link to the namespace. Once someone is a member, you can add them as an invitee on individual events.',
          'Adding someone to a team does not retroactively show them past events they were not invited to — the read gate is per event, evaluated in the contract rather than in the UI.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Shared events: title, time, owner and invitee list, replicated to team members and read-gated per event.',
          'Private events: the same fields, stored only on the node that created them and never replicated.',
          'Members: one username per member, so names can change without touching events.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A teammate cannot see your event', def: 'Shared events are visible to the owner and the invitees. Add them as an invitee — being in the team is not by itself enough.' },
          { term: 'A private event vanished on another device', def: 'Private events are node-local by design. A second device with a different node has its own set.' },
          { term: 'Names show as keys', def: 'That member has not set a username yet.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A week, shared', body: 'Team events sit in replicated state, each visible to its owner and the people invited to it.' },
      { title: 'An event is added', body: 'Creating one writes to the team’s context; every member’s node converges on the same week.' },
      { title: 'A private event, dashed', body: 'The dashed block is `#[app::private]` — stored on one node and never replicated to anyone.' },
      { title: 'Names, not keys', body: 'Each member carries a username so the calendar reads like a calendar.' },
    ],
  },
  'mero-design': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'A board is a shared canvas with real roles on it. Ownership is enforced at merge time, not only in the UI, which is the part worth understanding.',
        ],
        concepts: [
          { term: 'Namespace', def: 'A design space you own and invite collaborators into.' },
          { term: 'Context', def: 'One board — its elements, comments and cursors.' },
          { term: 'Element', def: 'A shape, a frame, a text node. Stored in a map keyed by id, with each mutable field as its own register so two people editing different properties of the same element do not collide.' },
          { term: 'Owner / editor / viewer', def: 'The three roles. The board name and description live in owner-gated storage: a rename from a non-owner is rejected when the change merges, not merely hidden by the interface.' },
          { term: 'Cursor', def: 'Where each collaborator is pointing. Ephemeral presence, kept apart from the board so a cursor update never touches your artwork.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Connect a node', body: 'Press Connect to node and choose your node in the popup.' },
          { title: 'Create a board', body: 'You are its owner. Name it, and set a description if it needs one.' },
          { title: 'Draw something', body: 'Add frames, shapes and text. Each element is a separate record, so collaborators editing different elements never queue behind each other.' },
          { title: 'Invite editors', body: 'Grant the editor role to the people who should be able to change things; everyone else can look.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Working together',
        paragraphs: [
          'Roles are granted and revoked by the owner, and ownership itself can be transferred. Comments carry their author, and only that author may edit or delete their own.',
          'Layer order, grouping and multi-select all operate on the same element records, so two people rearranging different groups converge without either losing a move.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Elements, keyed by id, with per-field registers for position, style, text and label.',
          'Comments and replies, each owned by its author.',
          'Members and their usernames, plus the role list.',
          'Cursors, as presence — deliberately not part of the document.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A rename did not stick', def: 'The board name is owner-gated. A non-owner’s rename is refused at merge, so it can appear locally for a moment and then revert.' },
          { term: 'You cannot edit', def: 'You have the viewer role. Ask the owner to grant editor.' },
          { term: 'Cursors are frozen', def: 'Presence stopped, not the board. Your elements are unaffected; reconnecting restores cursors.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A board with tools', body: 'Frames, shapes and text, each stored as its own record rather than one blob.' },
      { title: 'Two people editing', body: 'Separate elements mean separate records, so concurrent edits merge instead of overwriting.' },
      { title: 'Properties change live', body: 'Every mutable field is its own register — moving a shape does not conflict with recolouring it.' },
      { title: 'Cursors alongside', body: 'Presence rides separately from the document, so it can never rewrite the artwork.' },
    ],
  },

  'mero-drive': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'Mero Drive Docs is a multi-service bundle, and that structure is the product. A registry service holds the folder tree for a namespace; each folder is its own context holding its own documents.',
          'That is what makes selective sharing real: giving somebody a folder replicates that folder’s documents to them and nothing else, because the other folders are different contexts they were never added to.',
        ],
        concepts: [
          { term: 'Namespace', def: 'A workspace. The registry service in it holds the folder tree.' },
          { term: 'Folder', def: 'A record in the registry, bound once to a context id. The binding never changes after it is made.' },
          { term: 'Context', def: 'One folder’s documents. Sharing a folder means adding someone to this context.' },
          { term: 'Document', def: 'A rich-text document with an id like `doc-3`, allocated by a counter that produces distinct ids even when two people create a document at the same moment.' },
          { term: 'Owner / manager / folder role', def: 'The registry has one owner and any number of managers who may set roles on any folder. Individual folders can also carry their own per-person roles.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Connect a node', body: 'Press Connect to node and pick your node.' },
          { title: 'Create a workspace', body: 'The first person to claim it is the registry owner.' },
          { title: 'Make a folder', body: 'Registering a folder creates its context and binds the two together.' },
          { title: 'Write', body: 'Documents live in the folder’s context. Editing is collaborative and merges as you type.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Sharing a folder, not the workspace',
        paragraphs: [
          'Share at folder level. Someone given one folder gets that folder’s documents replicated to their node and has no copy of anything else in the workspace.',
          'Managers may set roles on any folder; a folder role applies to that folder alone. Because a folder is a context, a revoked member stops receiving its documents rather than merely losing a menu item.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Registry: folder records, the folder→context bindings, display order, colours and aliases, the owner and managers, and per-folder roles.',
          'Each folder’s context: its documents with their tags and archive state, plus comments, each owned by its author.',
          'Document edits are appended as updates, so concurrent typing merges rather than replacing.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A shared folder is empty for them', def: 'Being in the workspace is not being in the folder. They must be added to that folder’s context before its documents replicate.' },
          { term: 'A folder shows no documents after a move', def: 'Moving a folder changes its place in the tree, not its context binding, which is fixed once set. Reload the tree.' },
          { term: 'Two documents with the same name', def: 'Ids are allocated by counter and are always distinct; names are not unique by design. Rename one.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A folder’s documents', body: 'What you see is one context. Other folders in the workspace are other contexts entirely.' },
      { title: 'An edit merges', body: 'Edits append as updates, so two people typing in one document converge instead of overwriting.' },
      { title: 'A file uploads', body: 'Blobs replicate to the members of that folder — and to nobody else in the workspace.' },
      { title: 'Private by default', body: 'A folder is shared with the people you add to it. Nothing is workspace-wide unless you make it so.' },
    ],
  },

  'mero-forum': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        concepts: [
          { term: 'Namespace', def: 'A forum. Invite-only: the members are the audience, and there is no wider public.' },
          { term: 'Context', def: 'The forum’s posts, comments and votes.' },
          { term: 'Post', def: 'A thread, stored in a map keyed by id.' },
          { term: 'Comment', def: 'A reply. Every comment lives in one flat map carrying its post id, rather than a nested collection per post — a nested structure created independently on two nodes needs deterministic re-keying to converge, and a flat map has no such hazard.' },
          { term: 'Vote', def: 'One row per voter per post, keyed by both. That keying is what makes a vote idempotent: voting twice cannot count twice.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Connect a node', body: 'Press Connect to node and choose your node.' },
          { title: 'Create a forum', body: 'A namespace you own. Nothing in it is public.' },
          { title: 'Post something', body: 'Write a post; it replicates to members as their nodes sync.' },
          { title: 'Invite people', body: 'Share the link. Membership is the whole access model.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Who can see it',
        paragraphs: [
          'Only members. There is no ranking algorithm, no advertising and no anonymous readership, because there is no server hosting the forum for strangers to reach.',
          'Authorship is enforced in the contract: only a comment’s author may edit or delete it, whatever the interface offers.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Posts, keyed by id, with the author and body.',
          'Comments, in one flat map, each carrying the id of the post it belongs to.',
          'Votes, keyed by post and voter together, so a repeat vote replaces rather than accumulates.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A new post is not showing', def: 'Posts appear as peers sync. If a member’s node has been offline, it catches up on reconnect.' },
          { term: 'You cannot edit a comment', def: 'Only its author can. This is checked in the contract, not the UI.' },
          { term: 'A vote count looks low', def: 'One row per voter per post is the design — the count is voters, not clicks.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A thread list', body: 'Posts in a context only the forum’s members replicate.' },
      { title: 'A post arrives', body: 'A peer’s new thread appears as the nodes sync — nothing polled a server.' },
      { title: 'A reply nests', body: 'Comments live in one flat map carrying their post id, which is what lets them converge reliably.' },
      { title: 'No ranking', body: 'Order is time, not an algorithm. There is no operator to tune it.' },
    ],
  },

  'mero-issue-tracker': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'Issues here are shaped around what actually makes a bug actionable, which is why an issue has four required sections rather than one free-text box.',
        ],
        concepts: [
          { term: 'Namespace', def: 'A team. Its members are the people who can see and triage the board.' },
          { term: 'Context', def: 'The board itself — issues, comments and labels.' },
          { term: 'Issue', def: 'Title plus summary, impact, repro steps and resolution criteria, each stored as its own register so two people editing different fields never collide.' },
          { term: 'Label', def: 'An entry in a flat index keyed by issue and label together. That keying is why two people adding the same label at the same time produce one label, not two.' },
          { term: 'MCP server', def: 'A Model Context Protocol server exposing the board, so an AI coding agent can read an issue and its context directly rather than being pasted a screenshot.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Connect a node', body: 'Press Connect to node and pick your node in the popup.' },
          { title: 'Create a board', body: 'A namespace you own, with one board in it.' },
          { title: 'File an issue', body: 'Fill in summary, impact, repro and resolution criteria. The structure is the point — it is what makes the issue usable by someone who is not you.' },
          { title: 'Triage together', body: 'Status, priority, assignee and labels are all editable by any member, and everyone sees the board move as nodes sync.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Working with an agent',
        paragraphs: [
          'Any issue can be rendered as a prompt for a coding agent in one click, carrying the four sections as written.',
          'For a tighter loop, the MCP server exposes the board directly, so an agent can list issues and read one without a human relaying the text.',
          'Comment authorship is enforced in the contract: only the author of a comment may edit or delete it.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Issues, keyed by id, with every mutable field as its own last-writer-wins register.',
          'Comments, each carrying an immutable author.',
          'A flat label index keyed by issue and label, so concurrent adds converge to one entry and removals are conflict-free.',
          'The repository URL for the board, if one is set.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A label appears twice', def: 'It should not — the index is keyed by issue and label together. If you see a duplicate, the two differ by case or whitespace.' },
          { term: 'Your edit was replaced', def: 'Per-field registers mean only the same field collides. Two people rewriting the same summary converge on the later one; a summary and a priority edit both survive.' },
          { term: 'A teammate’s column is stale', def: 'Their node is behind. The board catches up on sync without any action.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'Three columns', body: 'Todo, in progress, done — the board every member replicates, with no service hosting it.' },
      { title: 'A card moves', body: 'Status is one register on the issue. Moving a card collides with nothing else on it.' },
      { title: 'A teammate drags one back', body: 'Concurrent triage converges: the later status wins, and every other field is untouched.' },
      { title: 'An agent reads it', body: 'The same issue is available over MCP, so a coding agent gets the repro steps as written.' },
    ],
  },

  'mero-meet': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'Mero Meet splits a call across two planes. A Calimero context is the room and carries the signalling; the audio and video go directly peer-to-peer over WebRTC. No signalling server is the part every other "p2p" calling app still centralises.',
        ],
        concepts: [
          { term: 'Namespace', def: 'A room you own and invite people into.' },
          { term: 'Context', def: 'The room’s membership, lobby, chat and — crucially — the signalling messages.' },
          { term: 'Signal', def: 'A WebRTC offer, answer or ICE candidate, posted into the context and read by the other participant. This is the job a signalling server normally does.' },
          { term: 'Media', def: 'The audio and video. It never enters the context and never touches a server: once signalling has done its work, the streams are a direct connection between the two browsers.' },
          { term: 'Host', def: 'A grantable role. The room name is owner-gated, so a rename from a non-owner is rejected at merge.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Install the desktop app', body: 'Mero Meet needs the Calimero desktop app for its node, sign-in and media bridge. This web page is the front door, not the product.' },
          { title: 'Create a room', body: 'A namespace you own. Name it; you are its host.' },
          { title: 'Invite people', body: 'Share the link. Joining puts them in the lobby.' },
          { title: 'Start the call', body: 'Signalling flows through the context, then the media connects directly between participants.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Who can join',
        paragraphs: [
          'Only members of the room’s namespace. An invitation is a link scoped to that room; there is no dial-in number and no public URL that anyone can open.',
          'Host is a role you grant and revoke. Leaving a call is separate from leaving the room, so stepping out does not remove you from the membership.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Members, their presence, and the lobby.',
          'Signalling messages, which are what the room exists to carry.',
          'Chat messages posted during a call.',
          'No media, ever. Audio and video are not written to the context and are not recorded.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: '"Connect to node" is not offered on the web', def: 'Deliberate. This app needs the desktop app’s node and media bridge, so offering a connection it cannot use would be a dead end.' },
          { term: 'Someone joined but has no video', def: 'Signalling succeeded and the media connection did not. That is a WebRTC path problem between the two networks, not a Calimero one.' },
          { term: 'A rename reverted', def: 'The room name is owner-gated and a non-owner’s rename is refused when it merges.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A room, in a context', body: 'Membership and the lobby live in a Calimero context you own.' },
      { title: 'Participants join', body: 'Each arrival is a member of the namespace — there is no public join link for strangers.' },
      { title: 'Signalling rides the context', body: 'Offers, answers and ICE candidates are posted into the room. This is the piece normally rented from a server.' },
      { title: 'Media goes direct', body: 'Audio and video connect browser to browser and are never written down anywhere.' },
    ],
  },

  'mero-pass': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        concepts: [
          { term: 'Namespace', def: 'A vault. You create it and invite the people who should hold its secrets.' },
          { term: 'Context', def: 'The vault’s contents — the secrets themselves and the audit log.' },
          { term: 'Secret', def: 'One entry in a map keyed by id. Five kinds: a login, a secure note, a TOTP seed, an SSH key, and free-form.' },
          { term: 'TOTP', def: 'A time-based one-time-password seed. Codes are generated locally from the seed; no code is ever stored or transmitted.' },
          { term: 'Audit log', def: 'A record of what happened in the vault, replicated with it, so the history is not something a vendor could withhold.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Connect a node', body: 'Press Connect to node and choose your node.' },
          { title: 'Create a vault', body: 'A namespace you own. Nothing in it leaves the members you invite.' },
          { title: 'Add a secret', body: 'Pick one of the five types. Logins carry a URL; TOTP entries carry a seed and generate codes on your own machine.' },
          { title: 'Share with the team', body: 'Invite the people who need it. Their node replicates the vault; there is no vendor holding a copy.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Sharing, and taking it back',
        paragraphs: [
          'Membership is the access model. Revoking someone stops the vault replicating to them — it is an action you take, not a support request.',
          'Because there is no central store, there is no central store to breach. The threat model moves from "a vendor is compromised" to "a member’s node is compromised", which is a risk you can see and act on.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Secrets, keyed by id, each with its type, tags and payload.',
          'An audit log of vault activity.',
          'Nothing on any server: the vault exists on the nodes of the people you invited, and nowhere else.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A TOTP code is rejected', def: 'Codes are time-based and generated locally. A wrong code almost always means your machine’s clock has drifted.' },
          { term: 'A teammate cannot see a secret', def: 'They must be a member of that vault. Being in another vault with you grants nothing here.' },
          { term: 'A secret you deleted is back', def: 'A peer that was offline when you deleted it can resurface its copy on reconnect if it also edited it. Delete it again once both nodes are in sync.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A vault of secrets', body: 'Entries in a context replicated only to the people invited to that vault.' },
      { title: 'One reveals', body: 'Decryption happens on your machine. Nothing is fetched from a service to show it.' },
      { title: 'A TOTP ticks', body: 'Generated locally from a stored seed — the code itself is never stored or sent.' },
      { title: 'A member is added', body: 'Sharing is membership. Revoking it stops replication rather than filing a request.' },
    ],
  },

  'mero-pixart': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'A genuinely deep raster editor — layers, masks, blend modes, curves — that several people can work in at once. The reason that is possible is that a document is a set of layer records, not one image file.',
        ],
        concepts: [
          { term: 'Namespace', def: 'A workspace you own and invite collaborators into.' },
          { term: 'Context', def: 'One document: its canvas size, its layers, its members and their cursors.' },
          { term: 'Layer', def: 'A record in a map keyed by layer id — raster, text or fill. Content, mask, transform and adjustments are separate fields, so painting on a layer does not conflict with moving it.' },
          { term: 'Adjustment', def: 'Non-destructive. Brightness, contrast, saturation, hue, exposure, blur and invert are stored as parameters and applied at render time, so the pixels underneath are never rewritten.' },
          { term: 'Owner / editor', def: 'The document name and description are owner-gated: a rename from a non-owner is rejected when it merges, not merely hidden.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Connect a node', body: 'Press Connect to node and pick your node.' },
          { title: 'Create a document', body: 'Choose a canvas size. You are the owner.' },
          { title: 'Work in layers', body: 'Add raster, text and fill layers, group them in folders, and reorder freely.' },
          { title: 'Invite editors', body: 'Grant the editor role. Everyone else can watch the document change without being able to change it.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Working together',
        paragraphs: [
          'Because each layer is its own record with separate fields, two people working on different layers never contend, and two people doing different things to one layer — one painting, one transforming — usually do not either.',
          'Cursors are presence, kept apart from the document, so watching someone move never touches the artwork.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Canvas size and background.',
          'Layers, keyed by id, with content, mask, transform, adjustments and text as separate fields.',
          'Members and their usernames, plus roles.',
          'Cursors, as presence.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A layer jumped back', def: 'Two people moved the same layer. The transform is one field and converges to the later move; the pixels are untouched.' },
          { term: 'An adjustment looks different on their screen', def: 'Adjustments render from parameters, so a difference means one node has not received the latest parameter yet. It resolves on sync.' },
          { term: 'You cannot edit', def: 'You hold the viewer role. Ask the owner for editor.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A layer stack', body: 'Raster, text and fill layers in a tree — each one a separate record in the context.' },
      { title: 'A stroke is drawn', body: 'Painting writes to that layer’s content field and nothing else on it.' },
      { title: 'An adjustment applies', body: 'Non-destructive: parameters are stored, the pixels underneath are not rewritten.' },
      { title: 'A collaborator joins', body: 'Their cursor rides separately from the document, so presence can never damage the art.' },
    ],
  },

  'mero-sheets': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'The unusual thing about this spreadsheet is how formulas are stored: raw, never as a cached result. Every peer re-evaluates a formula whenever a cell it references changes, so nobody is ever looking at a stale total computed on someone else’s machine.',
        ],
        concepts: [
          { term: 'Namespace', def: 'A project you own and invite collaborators into.' },
          { term: 'Context', def: 'One workbook: its sheets, its cells and its cursors.' },
          { term: 'Sheet', def: 'A tab. Stored as a record; a workbook can hold several.' },
          { term: 'Cell', def: 'One entry in a map keyed by sheet and coordinate. Value, formula and format are separate, so formatting a cell does not fight with typing in it.' },
          { term: 'Cursor', def: 'Where each collaborator is, in their own colour. Authored presence, kept out of the data.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Connect a node', body: 'Press Connect to node and choose your node.' },
          { title: 'Create a project', body: 'A namespace you own, with one workbook in it.' },
          { title: 'Type something', body: 'Enter values, or a formula: SUM, AVERAGE, MIN, MAX, COUNT and IF are built in, with autocomplete and inline help.' },
          { title: 'Invite collaborators', body: 'Share the link. Their cursor appears in its own colour as soon as they arrive.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Editing at the same time',
        paragraphs: [
          'Edits are applied per cell, so two people in different cells never queue behind each other. A burst of changes can be sent as one batch rather than one call per keystroke.',
          'Formulas are re-evaluated per peer. If you change A1 and someone else is looking at a SUM over A1:A3, their total updates from the raw formula on their own machine — no stale cached value travels between you.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Project name and creation time.',
          'Sheets, keyed by id, with their names.',
          'Cells, keyed by sheet and coordinate, holding the raw value, the raw formula and the format separately.',
          'Cursors, as authored presence — each one owned by the person it belongs to.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A total looks wrong', def: 'Totals are computed locally from the raw formula. A wrong total means a referenced cell has not arrived yet; it corrects itself on sync.' },
          { term: 'Your formatting was lost', def: 'Value, formula and format are separate fields. Losing formatting but keeping the value means someone reformatted the same cell, not that the write failed.' },
          { term: 'A collaborator’s cursor is stuck', def: 'Presence stopped, not their edits. Cells continue to sync regardless.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A filled grid', body: 'Cells are individual records keyed by sheet and coordinate — not one document blob.' },
      { title: 'Two cursors', body: 'Every collaborator in their own colour, carried as presence beside the data.' },
      { title: 'A formula recalculates', body: 'The formula is stored raw. Each peer re-evaluates it, so nobody sees a total computed somewhere else.' },
      { title: 'Edits merge', body: 'Different cells never contend; the same cell converges on the later write.' },
    ],
  },

  'mero-sign': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'An e-signature workflow with no signing service in the middle. An agreement is a context you administer, and your signature library is a separate, private one only you can read.',
        ],
        concepts: [
          { term: 'Namespace', def: 'An agreement. You create it, and you administer who signs.' },
          { term: 'Context', def: 'The agreement’s documents, participants and signature records.' },
          { term: 'Private context', def: 'Your signature library. A context only you are in, so the signatures you have drawn never replicate to anyone — including the people you sign agreements with.' },
          { term: 'Participant', def: 'Someone invited to sign, in a role you assign. Participation is recorded in the contract, not just in the interface.' },
          { term: 'Consent', def: 'An explicit, recorded agreement to sign electronically, stored alongside the signature record.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Connect a node', body: 'Mero Sign opens its connection panel from the landing page; choose your node there.' },
          { title: 'Create an agreement', body: 'A context you administer. Upload the PDF that needs signing.' },
          { title: 'Add participants', body: 'Invite the signatories and assign their roles.' },
          { title: 'Sign', body: 'Signatures are drawn from your private library and recorded against the document.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Inviting signatories',
        paragraphs: [
          'Invitations are tied to identities and carry permissions, so an agreement is not a link anyone can open and sign.',
          'Verification is peer-to-peer: a signature can be checked against the record without asking a service whether it is genuine.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Documents uploaded to the agreement, and the signature records against them.',
          'Participants, their roles, and their recorded consent.',
          'Identity mappings, so a person’s shared identity and private identity can be resolved without exposing one to the other.',
          'Your signature library, in a private context that replicates to nobody.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A signatory cannot sign', def: 'They must be a participant with a role on that agreement. Being a member of the namespace is not the same as being a signatory.' },
          { term: 'Your signature is missing on another device', def: 'Your library is a private context, node-local by design. A different node has a different library.' },
          { term: 'A document will not open', def: 'The blob must have replicated to your node. Large uploads land after the record that references them.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A document to sign', body: 'The PDF lives in the agreement’s context, replicated only to its participants.' },
      { title: 'Fields fill in', body: 'Each signature is recorded against the document with its signer and role.' },
      { title: 'Consent is recorded', body: 'Agreeing to sign electronically is stored with the signature, not assumed.' },
      { title: 'Verified peer-to-peer', body: 'A signature is checked against the record — there is no service to ask whether it is real.' },
    ],
  },

  'mero-stream': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'Mero Stream is a capacity probe, not a finished product, and this page would rather say so than oversell it. It exists to find out how far live media can be pushed through a peer-to-peer context, and to report the answer honestly.',
        ],
        concepts: [
          { term: 'Namespace', def: 'A stream you own and invite viewers into.' },
          { term: 'Context', def: 'The stream: its members, its frames and its chunks.' },
          { term: 'Frame', def: 'A picture encoded by a deterministic, integer-only codec running inside the WASM app. No floating point, no SIMD, no threads — so every node computes a byte-identical result.' },
          { term: 'Chunk', def: 'The other path: H.264 encoded by the browser’s WebCodecs and stored as fragments. Faster, but the browser is doing the encoding rather than the contract.' },
          { term: 'Tombstone', def: 'How a deleted fragment is recorded. Fragment keys are monotone and never reused, so a delete can never be confused with a fragment that has not arrived yet.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Use a browser', body: 'This app is web only. The desktop is not a supported target — it is not blocked there and does not crash; the integration around it is what is unsupported.' },
          { title: 'Connect a node', body: 'Press Connect to node and choose your node.' },
          { title: 'Create a stream', body: 'A namespace you own. You are its admin.' },
          { title: 'Watch the numbers', body: 'Throughput and delivery are reported as you go. That measurement is the actual output of this app.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'What it is honest about',
        paragraphs: [
          'Measured, not promised. Presence-based delivery carries roughly 96% of frames with one author and materially less with two — the bandwidth arithmetic suggested a higher number and the measurement did not agree.',
          'The deterministic codec is deliberately primitive. It exists so that every peer computes an identical frame, which makes the capacity question answerable at all.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Members and their roles.',
          'Frames from the deterministic codec, with a sequence number and a checksum.',
          'Media chunks from the WebCodecs path, with cursors marking keyframes.',
          'Pruning counters, so old frames can be dropped without breaking the monotone sequence.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'Frames are dropping', def: 'Expected, and the point. The app reports what got through rather than pretending everything did.' },
          { term: 'The camera does not start', def: 'WebCodecs H.264 needs a browser build that ships the codec. A stock Chromium without it will not encode.' },
          { term: 'It behaves oddly in the desktop app', def: 'Web only. Use a browser.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'Two nodes', body: 'An encoder and a decoder, with a real context between them rather than a media server.' },
      { title: 'Frames flow', body: 'Either deterministic frames computed inside the WASM app, or browser-encoded H.264 chunks.' },
      { title: 'Throughput is measured', body: 'The bar is the actual figure, not an illustration. Measuring it is what this app is for.' },
      { title: 'The ceiling is reported', body: 'Where delivery falls off, the app says so. An honest experiment beats a confident demo.' },
    ],
  },

  merraria: {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'Same model as Mero Blocks, in two dimensions: a world is a seed plus the tiles somebody changed, which is why it needs no game server and fits in a context.',
        ],
        concepts: [
          { term: 'Namespace', def: 'A world you own. Invite people and they dig in the same one.' },
          { term: 'Seed', def: 'One number. Terrain is generated from it deterministically on every machine, so no terrain is ever sent over the network.' },
          { term: 'Tile override', def: 'One changed tile, keyed by coordinate. Mining or placing writes an override; the override map is the only terrain data that syncs.' },
          { term: 'Presence', def: 'Other players’ positions, refreshed by heartbeat and kept apart from the world itself.' },
          { term: 'Offline mode', def: 'The game runs with no node at all, persisted to your browser. Nothing shared, nothing to set up.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Play offline', body: 'Start digging immediately with no node and no account. Progress is saved locally.' },
          { title: 'Connect a node', body: 'Press Connect to node when you want to share a world.' },
          { title: 'Create a world', body: 'Name it; you get a seed and you own the world.' },
          { title: 'Invite people', body: 'Share the link. Their client generates the same terrain and applies your edits on top.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Digging together',
        paragraphs: [
          'Edits are batched, so a run of mining goes to the contract as one call rather than one per tile.',
          'Overrides keyed by coordinate mean two players in different places never conflict. Two players changing the same tile converge on one result, and both then see the same world.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'World name, seed and creation time.',
          'Tile overrides, keyed by coordinate.',
          'Players and their positions, refreshed by heartbeat and reaped when they leave.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'The world looks different to them', def: 'Terrain comes from the seed, so different terrain means different worlds. Check you opened the same invite link.' },
          { term: 'A tile you mined came back', def: 'Someone placed one there concurrently. One of the two wins; mine it again.' },
          { term: 'Offline progress is missing', def: 'Offline worlds live in that browser’s storage and are separate from any shared world.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A world from a seed', body: 'Side-on terrain generated identically on every machine — none of it is transmitted.' },
      { title: 'Tiles are mined', body: 'Each change is an override keyed by coordinate, batched into one call.' },
      { title: 'A second player digs', body: 'Presence arrives separately, so another player joining never rewrites your world.' },
      { title: 'No game server', body: 'Seed plus overrides is the entire world. Nobody hosts it.' },
    ],
  },
};
