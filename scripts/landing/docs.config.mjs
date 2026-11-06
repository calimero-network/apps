/**
 * The `/docs` page for each app, and the captions for `/preview`.
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
  'mero-chess': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'A game of chess is a Calimero app instance. There is no game server keeping the board: the cluster’s log orders every move, and the rules — legal moves, check, mate, the draws — are inside the contract that runs each one, so the contract is the referee.',
        ],
        concepts: [
          { term: 'Organization', def: 'A club. You create one with your first table, invite the people you play with, and every table inside it is open to them without another invitation.' },
          { term: 'Table', def: 'One app instance. It holds the seats, the move list and the record of every game played at it — one board, as many games as you like.' },
          { term: 'Seat', def: 'White or black. The first person to take a chair holds it; once they have played from it, it is theirs for good. The colours swap on every rematch, the way they do across a real board.' },
          { term: 'The move list', def: 'Every move of every game, in order. The position is replayed from it, which is how the contract knows about repetitions.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Sign in', body: 'Sign in with a passkey, or create an account with a new one. There is no password and no email.' },
          { title: 'Open a table', body: 'New table creates an organization and a table in it. Joining someone else’s means opening their invite link.' },
          { title: 'Take a seat', body: 'Claim white or black and give yourself a name. The game begins when both chairs are taken.' },
          { title: 'Play', body: 'Click a piece and then a square. The squares offered are the legal moves the contract handed your client, so the board never shows a move the contract would refuse.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Playing with someone else',
        paragraphs: [
          'Invitations are links, approved with your passkey when you make one. Whoever opens it signs in (or creates an account), joins, and lands at the table, where they can take the free seat or watch.',
          'The invitation admits someone to the organization the table lives in, so one link is enough for every table in that organization — a club rather than a single game.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'The move list, keyed by game and ply. Each entry holds the move in UCI, its notation, who played it and when.',
          'The two seats, each recording who holds it and since when.',
          'Each game as it stands: how many moves, the result and how it ended, and the draw offers standing in the current position.',
          'Nothing is private here. Chess is a game of complete information, so everything in the state is meant to be seen by both players.',
        ],
      },
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'Your move is refused', def: 'The contract refuses a move that is not legal, is out of turn, or arrives in a finished game — and it says which. If the board offered the square, your client is reading a position the table has already moved past; it re-reads after every call.' },
          { term: 'The other player looks offline', def: 'Presence expires after thirty seconds without a call from them. It means "not heard from", not "gone": the table waits for their move.' },
          { term: 'You both moved at once', def: 'Only the side to move can play, and the log orders the two calls: the first one plays and the second is refused.' },
          { term: 'The invite link does nothing', def: 'An invitation is redeemed once, after you sign in. Ask for a fresh one rather than reusing an old link.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A board that is an app', body: 'Two seats and a move list, ordered by one log on attested nodes. Nothing to host.' },
      { title: 'The contract knows the rules', body: 'Your client asks for the legal moves rather than working them out, so the squares it offers are the squares the contract will accept.' },
      { title: 'A move is a transaction', body: 'Every move is a call the log orders. Two players cannot both take the same turn.' },
      { title: 'The rules decide the result', body: 'Nobody types in "checkmate": the contract sees it on the board the moment the mating move is played.' },
    ],
  },
  'mero-models': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'A 3D scene is a Calimero app instance in your studio’s organization. Only the studio’s members reach it, every change goes through the contract, and one log orders them all.',
        ],
        concepts: [
          { term: 'Studio', def: 'An organization. You create one with your first scene, invite the people you build with, and every scene inside it is open to them without another invitation.' },
          { term: 'Scene', def: 'An app instance. It holds the objects, their meshes and textures, the world settings and who may edit.' },
          { term: 'Object', def: 'One thing in the outliner: a primitive, a mesh, a light or an empty, with a transform, a material and a parent.' },
          { term: 'Mesh', def: 'The polygon cage of an edited or imported shape — quads and n-gons, UVs, hard edges and its modifiers — stored as a versioned blob apart from the object, so moving it never rewrites them.' },
          { term: 'Editor', def: 'Someone the scene’s admin has allowed to change it. Everyone else in the studio can open the scene and watch.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Sign in', body: 'Sign in with a passkey, or create an account with a new one. There is no password and no email.' },
          { title: 'Start a scene', body: 'Name it and press New scene. That creates a studio you own and a scene inside it, with you as its admin.' },
          { title: 'Build', body: 'Shift+A adds a primitive. Drag the gizmo to move it; G, R and S switch between move, rotate and scale, Tab models the mesh — 1, 2 and 3 pick vertices, edges or faces; E, I, Ctrl+B and Ctrl+R extrude, inset, bevel and loop-cut — and Ctrl+Z undoes. Mark seams and press U to unwrap, then Bake & texture paints a smart material onto it. Add → Examples loads finished assets built the same way.' },
          { title: 'Invite', body: 'Share mints a link, approved with your passkey. Whoever opens it can watch at once; tick Can edit beside their name to let them build too.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Building with someone else',
        paragraphs: [
          'Invitations are links. Opening one and signing in with a passkey is the whole of joining: the invitation makes you a member of the studio.',
          'The others in the scene appear as coloured avatars. Their selections are outlined in their colour, their camera is a small marker in the viewport, and clicking an avatar takes you to their view.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'One record per object: its name, kind, parent, position, rotation, scale, visibility, material and light settings. Two people changing the same object end with the later write, whole.',
          'Meshes and textures as the scene’s own blobs — up to 4 million vertices a mesh, 16,384 pixels a side a texture, and at most 47.25 MiB each once encoded. State holds only a reference to each: the blob id, its size and what is in it.',
          'Every version of every mesh and texture, in order, with who saved it and an optional note. Restoring writes the old blob again as a new version, so nothing is ever copied.',
          'Check-outs: who holds which asset, and until when. While one is live, the contract refuses anyone else’s change to that asset.',
          'The scene’s name, background and ambient light, and each member’s display name.',
          'Who may edit, as a role the admin grants, checked by the contract on every write.',
          'Not stored: cameras and selections. They stream over presence and vanish when you leave.',
        ],
      },
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'Your edit is refused', def: 'You are a viewer. The admin can tick Can edit beside your name in Share.' },
          { term: 'An object jumped back', def: 'Someone else moved it at the same moment, and theirs was the later write. Move it again.' },
          { term: 'An object is read-only', def: 'Someone else has it checked out — the outliner shows a lock and Properties says who. It frees itself when they check it in or the check-out lapses; an admin can release it.' },
          { term: 'A mesh is refused as too large', def: 'One mesh or texture is at most 47.25 MiB once encoded. Decimate it, split it into several objects, or use a smaller image.' },
          { term: 'The invite link does nothing', def: 'An invitation is redeemed once, after you sign in. Ask for a fresh one rather than reusing an old link.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A scene in your studio', body: 'Objects, meshes and materials in one app instance only your studio’s members reach.' },
      { title: 'Edit like a modeller', body: 'Primitives, a gizmo, edit mode with extrude, and the shortcuts you already know.' },
      { title: 'Together, live', body: 'Every change reaches everyone as it is made, and you can see where the others are looking.' },
      { title: 'Out in standard formats', body: 'glTF, OBJ and STL, whenever you want them.' },
    ],
  },
  'mero-kombat': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'An arena is a Calimero app instance. There is no game server: the cluster\u2019s log orders every blow thrown, and the contract applies each one to the score as it lands, so every screen reads the same verdict.',
        ],
        concepts: [
          { term: 'Organization', def: 'A dojo. You create one with your first arena, invite the people you fight, and every arena inside it is open to them without another invitation.' },
          { term: 'Arena', def: 'One app instance. It holds the two corners and every action either fighter has taken, across as many matches as you like.' },
          { term: 'Corner', def: 'Left or right. The first person to take a corner holds it; once they have fought from it, it is theirs for good.' },
          { term: 'Action', def: 'One finished move \u2014 a punch, kick, uppercut, sweep, flying kick, special, jump or block \u2014 and one contract transaction.' },
          { term: 'Presence', def: 'Where your fighter stands, fifteen times a second, over the node\u2019s ephemeral channel. Never stored, never a transaction.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Sign in', body: 'Sign in with a passkey, or create an account with a new one. There is no password and no email.' },
          { title: 'Open an arena', body: 'New arena creates an organization and an arena in it. Joining someone else\u2019s means opening their invite link.' },
          { title: 'Pick a fighter and a corner', body: 'Choose Kinetic, Cryo, Inferno or Jinzo and take an open corner. The fight starts when both corners are taken and both fighters are in the arena.' },
          { title: 'Fight', body: 'A and D move, W jumps, S crouches. J punches, K kicks, L blocks and I throws your special. Crouch with J for an uppercut, crouch with K for a sweep, and K in the air for a flying kick.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Fighting someone else',
        paragraphs: [
          'Invitations are links, approved with your passkey when you make one. Whoever opens it signs in (or creates an account), joins, and lands in the arena, where they can take the open corner or watch.',
          'The invitation admits someone to the organization the arena lives in, so one link is enough for every arena in that organization.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Every action: what it was, who threw it, in which match and round, whether it connected, whether it was blocked, and who was in the other corner.',
          'The two corners, each recording who holds it and since when.',
          'Each match as it stands: the round, the damage each fighter has taken in it, the rounds decided and the winner.',
          'Each player\u2019s name, fighter and last sign of life. Movement never: that is presence.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A transaction is refused', def: 'A blow written for a round that has already ended, or after the match is over, is refused by the contract. It shows in the chain panel and changes nothing.' },
          { term: 'The other fighter looks away', def: 'Their presence stream stopped for a few seconds. The fight waits for them; their blows count when they reconnect.' },
          { term: 'The health bars jump back', def: 'A blow your screen saw over presence never reached the contract. The bars settle on what the contract counts.' },
          { term: 'The invite link does nothing', def: 'An invitation is redeemed once, after you sign in. Ask for a fresh one rather than reusing an old link.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'An arena that is an app', body: 'Two corners and every blow thrown, ordered by one log on attested nodes. Nothing to host.' },
      { title: 'Movement over presence', body: 'Where each fighter stands streams fifteen times a second over ephemeral presence \u2014 fast, and never stored.' },
      { title: 'Blows are transactions', body: 'Every finished punch, kick, jump and block is a contract call, executed and stored.' },
      { title: 'The contract keeps the score', body: 'Nobody writes down "K.O.": the contract applies each blow and ends the round when a fighter has taken a hundred.' },
    ],
  },
  battleships: {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'Battleships is one Calimero app: a lobby that pairs players, runs every match and keeps the record. The cluster’s log orders every shot, and the contract that runs each one is the referee.',
        ],
        concepts: [
          { term: 'Organization', def: 'Who is in the lobby. You create one with the lobby, invite the people you want to play against, and every match you play together is recorded in it.' },
          { term: 'Lobby', def: 'One app instance. It holds the players, every match — the shots fired, whose turn it is, the result — and everyone’s record.' },
          { term: 'Board on the device', def: 'Where your fleet lives: in this browser’s storage, keyed by you and the match. The contract records only its hash, so nobody — your opponent, the cluster, the app — has a copy to inspect at any point in the game.' },
          { term: 'Commit-reveal', def: 'You commit to a board layout before the first shot and reveal it at the end. The commitment is what stops either side quietly moving a ship after seeing where the shots land.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Sign in', body: 'Sign in with a passkey, or create an account with a new one. There is no password and no email.' },
          { title: 'Create or join a lobby', body: 'A new lobby creates an organization and the lobby in it. Joining someone else’s means opening their invite link.' },
          { title: 'Place your fleet', body: 'Drag ships onto your grid. The board is saved on this device and only its commitment is sent before play begins.' },
          { title: 'Take turns', body: 'Fire at a square; your opponent’s app answers hit or miss from the board on their device. When one fleet is gone, both boards are revealed and audited, and the lobby records who won.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Playing with someone else',
        paragraphs: [
          'Invitations are links into the lobby’s organization, approved with your passkey. There is no email address: opening the link and signing in is the whole of joining.',
          'Everyone in the organization can challenge everyone else who has opened the lobby, without a second invitation for each game.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'The lobby stores the players, the matches, a per-player win/loss record and a history of finished matches, in one app instance.',
          'Each match stores the two commitments, the shots and their answers, and at the end the two revealed boards.',
          'Your fleet placement lives in this browser’s storage and nowhere else until the match ends. The contract holds its hash, then the reveal. Clearing site data mid-match loses the board — and with it the ability to answer shots or reveal.',
        ],
      },
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'The opponent’s shots are not arriving', def: 'Check the Live indicator on the match. A closed event stream reopens on its own, and the match is re-read every few seconds either way.' },
          { term: 'The invite link does nothing', def: 'An invitation is used once and expires. Ask for a fresh one rather than reusing an old link.' },
          { term: 'You cannot see the other player’s board', def: 'That is the design, not a fault. It is revealed at the end of the match.' },
          { term: 'Your board is not on this device', def: 'You placed the fleet in another browser, or this one cleared its storage. Shots can only be answered, and the board only revealed, from where it was placed.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'Two grids, one private', body: 'Your fleet on the left, their water on the right. Yours is drawn from this device’s storage; nobody else holds it.' },
      { title: 'A shot is taken', body: 'Firing is a call the lobby’s log orders, so there is exactly one shot per turn.' },
      { title: 'Hit or miss comes back', body: 'Their app answers from the board on their device. The answer is on record, and the reveal at the end is replayed against it.' },
      { title: 'The lobby records it', body: 'When a fleet is gone and the boards pass the audit, the same call records the winner in the lobby.' },
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
          { title: 'Sign in', body: 'Press Sign in to move from a local world to a shared one. The same button creates your passkey account the first time.' },
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
          'Mero Calendar holds two kinds of event with different audiences in the same screen, and booking links for people with no account.',
        ],
        concepts: [
          { term: 'Team', def: 'A Calimero organization. The people in it are the people who can be invited to events.' },
          { term: 'Calendar', def: 'An app instance in the team. A team can hold several; every member reaches each one.' },
          { term: 'Shared event', def: 'An event with invitees, owned by whoever created it. Only its owner can change it; only its owner and invitees can read it.' },
          { term: 'Private event', def: 'An event with nobody else in it. Only you can read it: no other member reaches it through the app.' },
          { term: 'Username', def: 'A display name you set per calendar, so the UI shows people rather than account ids.' },
          { term: 'Booking link', def: 'A link that lets one person with no account book one meeting with you, then reschedule or cancel it. Its token is an API key of yours limited to the five booking methods.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Sign in', body: 'Press Sign in and use a passkey, or create an account with a new one.' },
          { title: 'Create a team', body: 'A team you own, then a calendar in it.' },
          { title: 'Set your name', body: 'Set a username so your teammates see a name instead of an account id.' },
          { title: 'Create an event', body: 'Add invitees to share it; with none it stays private.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Inviting people',
        paragraphs: [
          'Joining a team is an invite link. Once someone is a member, you can add them as an invitee on individual events.',
          'Adding someone to a team does not show them past events they were not invited to: the read rule is per event, checked in the contract.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Shared events: title, time, owner and invitee list, readable by the owner and the invitees and editable only by the owner.',
          'Private events and booking links: the same kind of rows, keyed by your account and read only by your own calls.',
          'Members: one username per member, so names can change without touching events.',
          'All of it in one app on attested Calimero nodes, which apply every change in one ordered log.',
        ],
      },
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A teammate cannot see your event', def: 'Shared events are visible to the owner and the invitees. Add them as an invitee: being in the team is not by itself enough.' },
          { term: 'You cannot edit an event', def: 'Only the person who created it can. Ask them, or create your own.' },
          { term: 'Names show as ids', def: 'That member has not set a username yet.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A week, shared', body: 'Team events, each visible to its owner and the people invited to it.' },
      { title: 'An event is added', body: 'Creating one is one call; the calendar updates for everyone invited.' },
      { title: 'A private event, dashed', body: 'The dashed block has nobody else in it: only its owner reads it.' },
      { title: 'Names, not ids', body: 'Each member carries a username so the calendar reads like a calendar.' },
    ],
  },
  'mero-chat': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'Mero Chat maps the platform’s nouns onto the ones a chat app already has. Knowing which is which explains who can see what.',
        ],
        concepts: [
          { term: 'Organization', def: 'A workspace — the team you invite people into. Joining it is what makes you a member.' },
          { term: 'App instance', def: 'One channel or one direct message: its messages, threads, reactions, profiles and roles. A public channel reaches every member of the workspace; a private one only the people added to it.' },
          { term: 'Account', def: 'Who you are, held by a passkey on your devices. A message’s sender and a reaction are your account, which is how your name is shown next to them.' },
          { term: 'Presence', def: 'Who is here and who is typing. Ephemeral — it is never written into the channel’s history.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Sign in', body: 'Press Sign in and continue with your passkey, or create an account with a new one.' },
          { title: 'Create a workspace', body: 'Name it and pick the name people will see you by. You are its admin.' },
          { title: 'Create channels', body: 'Press + next to Channels. Choose Public for anyone in the workspace, or Private for only the people you add.' },
          { title: 'Invite your team', body: 'Share an invite link. Whoever opens it signs in and joins the workspace.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Working together',
        paragraphs: [
          'Everyone in a channel can post, react, reply in threads and edit or delete their own messages. Admins and moderators can delete any message and ban a member; only admins grant roles.',
          'Roles are checked by the channel’s code on every call, so a delete from someone without the right is refused — not just hidden in one interface.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Messages, in order, each stamped with its sender’s account and a timestamp.',
          'Thread replies, kept beside the message they answer.',
          'Reactions: for each message and emoji, the set of accounts that reacted.',
          'Profiles (display name, avatar), roles and per-member read positions.',
          'Files and images as blobs of the channel, referenced from the message.',
          'Drafts, readable by you alone. NOT stored: typing, which is presence.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A message you sent is not on their screen yet', def: 'Their live connection dropped. It reconnects and re-reads the channel; nothing is lost.' },
          { term: 'You cannot see a channel', def: 'It is private and you have not been added. Ask a member of it to add you.' },
          { term: 'Your delete was refused', def: 'You tried to delete someone else’s message without being an admin or moderator.' },
          { term: 'Attaching a file fails', def: 'The cluster runs a Calimero release without blobs for this kind of app yet. Messages still work.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'Pick a channel', body: 'Click between #general, #design and the private #leadership — each keeps its own conversation.' },
      { title: 'Send a message', body: 'Type in the box and press Enter. It lands in the channel straight away.' },
      { title: 'A teammate answers', body: 'Ada is typing — a moment later her reply arrives.' },
      { title: 'React', body: 'Click a reaction under any message to add yours, and again to take it back.' },
    ],
  },

  'mero-design': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'A board is a shared canvas with real roles on it. Ownership is enforced by the board itself, not only in the UI, which is the part worth understanding.',
        ],
        concepts: [
          { term: 'Team', def: 'An organization: a design space you own and invite collaborators into.' },
          { term: 'Board', def: 'An app instance in the team — its elements, comments and cursors. Every member of the team can open it.' },
          { term: 'Element', def: 'A shape, a frame, a text node. Stored in a map keyed by id, with the paint order kept beside it, so a change to one element never rewrites another.' },
          { term: 'Owner / editor / viewer', def: 'The three roles. Only the owner renames the board: a rename from anyone else is refused by the board, not merely hidden by the interface. Team admins can edit every board.' },
          { term: 'Cursor', def: 'Where each collaborator is pointing, kept apart from the elements so a cursor update never touches your artwork.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Sign in', body: 'Press Sign in and continue with your passkey, or create an account with a new one.' },
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
          'Layer order, grouping and multi-select all operate on the same element records, and every change is applied in order, so two people rearranging different groups both keep their moves.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Elements, keyed by id, and their paint order.',
          'Comments and replies, each stamped with its author.',
          'Members and their usernames, plus the role list.',
          'Cursors, one per person — deliberately apart from the elements.',
        ],
      },
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A rename did not stick', def: 'The board name is owner-gated. A non-owner’s rename is refused, and the app says so.' },
          { term: 'You cannot edit', def: 'You have the viewer role. Ask the owner to grant editor.' },
          { term: 'Cursors are frozen', def: 'The live connection dropped, not the board. Your elements are unaffected; it reconnects on its own.' },
        ],
      },
    ],
    previewSteps: [
      // Beats of the recorded hero loop (public/landing/hero.webm), in order.
      { title: 'Two people, one board', body: 'You and Ada have the same sign-in screen open, each in your own browser.' },
      { title: 'Her note lands live', body: 'Ada leaves a sticky note by the headline, and it appears on your canvas as she makes it.' },
      { title: 'You change the design', body: 'At the same moment you recolour the Sign in button. Neither of you waits for the other.' },
      { title: 'She sees it too', body: 'Ada’s cursor comes over to the button. Edits to different things never collide.' },
    ],
  },

  'mero-docs': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'Mero Docs is built folder by folder, and that structure is the product. Your workspace holds the folder tree, and each folder holds its own documents separately.',
          'That is what makes selective sharing real: a folder\u2019s documents are an app instance only that folder\u2019s members can reach, so giving somebody one folder gives them that folder and nothing else.',
        ],
        concepts: [
          { term: 'Workspace', def: 'An organization you and your members share. It holds the folder tree, the tags and the saved views.' },
          { term: 'Folder', def: 'A team of the organization. Open folders include everyone who can open the folder above; Restricted ones only the people added to them.' },
          { term: 'Document', def: 'A rich-text document in its folder, with a title and blocks of formatted text that several people can edit at once.' },
          { term: 'Folder role', def: 'Read only, Editor or Manager, per person and per folder. A Read only member can open documents, and the cluster refuses their writes.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Sign in', body: 'Sign in with a passkey, or create an account with a new one. There is no password and no email.' },
          { title: 'Create a workspace', body: 'An organization you own. Nothing in it is public.' },
          { title: 'Make a folder', body: 'A new folder can be shared on its own right away.' },
          { title: 'Write', body: 'Documents live inside their folder. Editing is collaborative: everyone in the folder sees each change as it is written.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Sharing a folder, not the workspace',
        paragraphs: [
          'Share at folder level. Someone invited to one folder reaches that folder\u2019s documents and nothing else in the workspace.',
          'Workspace admins, and the managers they appoint, set roles on any folder; a folder role applies to that folder alone. Removing someone from a folder stops their next request, on every node of the cluster.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Workspace: the organization\u2019s members and their names, the folders (teams) with their names, colours and roles, and one registry instance with the tags, saved views and managers.',
          'Each folder: one app instance with its documents, their tags and archive state, and comments, each owned by its author.',
          'Titles and paragraphs are sequence CRDTs, so an edit typed against a slightly older view still lands where its author meant.',
        ],
      },
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A shared folder is empty for them', def: 'Being in the workspace is not being in a Restricted folder. They must be added to that folder itself.' },
          { term: 'Changing a role asks for your passkey', def: 'Every membership change on Calimero is approved with the passkey of the person making it.' },
          { term: 'Two documents with the same name', def: 'Ids are distinct; names are not unique by design. Rename one.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A folder\u2019s documents', body: 'What you see belongs to one folder. Other folders in the workspace hold their own documents entirely.' },
      { title: 'An edit lands', body: 'Every edit goes through one log, so two people typing in one document see the same text.' },
      { title: 'An image uploads', body: 'Images are stored with the folder\u2019s instance, for its members and nobody else in the workspace.' },
      { title: 'Private by default', body: 'A Restricted folder is shared with the people you add to it. Nothing is public.' },
    ],
  },

  'mero-updates': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        concepts: [
          { term: 'Company', def: 'An organization the founder owns. Investors join it from an invitation link.' },
          { term: 'Audience', def: 'An instance of the app inside the company — “All investors”, “Angels” — holding its updates, replies and asks. Every company member can open every audience, so a confidential group is its own company.' },
          { term: 'Team', def: 'The audience’s creator and the company’s admins are admins; admins make co-founders teammates. Every write is checked against the team in the contract, so a reader cannot grant themselves publishing rights.' },
          { term: 'Update', def: 'A structured post: category, TL;DR, sections, KPIs and asks. Only the team publishes them.' },
          { term: 'Ask', def: 'A specific request inside an update — an intro, a hire, a customer. Investors answer with one click; accepted offers become contributions the next update thanks.' },
          { term: 'Question', def: 'A thread any member can open. Answers are visible to the whole audience, so a question is asked once.' },
          { term: 'Draft', def: 'Kept for its author only: no other account can list, read or change it, and it reaches investors only when published.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Sign in', body: 'Press Sign in and use a passkey, or create an account with a new one.' },
          { title: 'Create your company', body: 'Then an audience inside it, such as “All investors”.' },
          { title: 'Set it up', body: 'Name the company, pick a cadence and add categories — one click adds a starter set.' },
          { title: 'Publish and invite', body: 'Write from a template, publish, and share the invitation link with your investors.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Who can see it',
        paragraphs: [
          'Members of the company, and nobody else: there is no web view, no forwarded email and no vendor database. Everything except drafts is readable by every member of the audience.',
          'Some views are team-only — the list of who offered help, the read report — and the contract answers them to the team only. For something confidential, make a separate company with only the people who should see it.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Updates and questions keyed by id; an edit never touches a question’s or an ask’s triage status.',
          'Asks and offers of help, keyed so one person makes one offer per ask.',
          'Replies, reactions (one per person per emoji) and read receipts (first and latest open).',
          'Profiles, categories, settings, and each author’s own drafts — all in one app on attested Calimero nodes, which apply every change in one ordered log.',
        ],
      },
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'You cannot publish', def: 'Only the team can. An admin makes you a teammate from the People tab.' },
          { term: 'A read count looks low', def: 'A read is recorded when the member opens the update in the app.' },
          { term: 'An invitation does not open', def: 'Sign in first; the link is redeemed once, after you confirm the join.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'An update lands', body: 'Published by the team, on every investor’s screen — nothing was emailed.' },
      { title: 'KPIs with context', body: 'Each tile shows the change since the last report, computed rather than typed.' },
      { title: 'An investor offers help', body: 'One click on an ask; the founder accepts it and it becomes a contribution.' },
      { title: 'The conversation goes both ways', body: 'Replies, reactions and questions from investors, visible to the team as they happen.' },
    ],
  },

  'mero-forum': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        concepts: [
          { term: 'Space', def: 'An organization. Invite-only: its members are the audience, and there is no wider public.' },
          { term: 'Forum', def: 'An app instance in the space: its posts, comments and votes. Every member of the space can open every forum in it.' },
          { term: 'Post', def: 'A thread, stored as a row keyed by a random id, with its author and its score.' },
          { term: 'Comment', def: 'A reply. Every comment is a row carrying its post id, so one post\u2019s thread is one index read.' },
          { term: 'Vote', def: 'One entry per voter per post, keyed by both. That keying is what makes a vote idempotent: voting twice cannot count twice.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Sign in', body: 'Sign in with a passkey, or create an account with a new one. There is no password and no email.' },
          { title: 'Create a space', body: 'An organization you own. Nothing in it is public.' },
          { title: 'Create a forum and post something', body: 'Write a post; every member of the space sees it as soon as it is written.' },
          { title: 'Invite people', body: 'Share the link, approved with your passkey. Membership is the whole access model.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Who can see it',
        paragraphs: [
          'Only members of the space. There is no ranking algorithm, no advertising and no anonymous readership: a caller who is not in the space is refused before the forum runs.',
          'Authorship is enforced in the contract: only a post\u2019s or comment\u2019s author may edit or delete it, and only a moderator may remove someone else\u2019s, whatever the interface offers.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Posts, keyed by id, with the author, the body and the score.',
          'Comments, each carrying the id of the post it belongs to.',
          'Votes, keyed by post (or comment) and voter together, so a repeat vote replaces rather than accumulates.',
          'Each member\u2019s display name, written only by that member, and the list of moderators.',
        ],
      },
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'You cannot edit a post or comment', def: 'Only its author can. This is checked in the contract, not the UI.' },
          { term: 'A vote count looks low', def: 'One vote per member per post is the design \u2014 the count is voters, not clicks.' },
          { term: 'The invite link does nothing', def: 'An invitation is redeemed once, after you sign in. Ask for a fresh one rather than reusing an old link.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A thread list', body: 'Posts in a forum only the members of its space can read.' },
      { title: 'A post arrives', body: 'A member\u2019s new thread appears as soon as it is written \u2014 the feed follows the forum\u2019s events.' },
      { title: 'A reply lands', body: 'Comments are rows carrying their post id, read a page at a time, oldest first.' },
      { title: 'No ranking', body: 'Order is time, or votes. There is no operator to tune it.' },
    ],
  },


  'mero-crm': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'The model is deliberately small: a pipeline of stages, deals moving through them, the people behind the deals, and the activities that move them forward.',
        ],
        concepts: [
          { term: 'Workspace', def: 'Your sales team: an organization whose members are the people who can see and work its pipelines.' },
          { term: 'Pipeline', def: 'One sales process — say New business or Renewals — and one app in the workspace. It holds its stages, deals, people, activities, notes and automations.' },
          { term: 'Stage', def: 'A column of the pipeline with a win probability. The probability is what turns a pipeline total into a weighted forecast.' },
          { term: 'Deal', def: 'An opportunity with a value, an owner, a contact person and an expected close date.' },
          { term: 'Activity', def: 'A call, meeting, task, email or deadline, due on a date. The earliest open one is the deal’s next step.' },
          { term: 'Rotting', def: 'An open deal nobody has touched for longer than the pipeline allows (14 days by default). It is flagged on the board.' },
          { term: 'Automation', def: 'A rule of the form “when a deal enters this stage, schedule this activity”. It runs inside the contract, so it fires whoever moves the deal.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Sign in', body: 'Press Sign in and use a passkey, or create an account with a new one.' },
          { title: 'Create a workspace and a pipeline', body: 'A workspace for the team, then a pipeline with its currency. It starts with five stages you can rename, reorder and re-weight in Settings.' },
          { title: 'Add your deals', body: 'Press N anywhere. Only a title is required; the value accepts shorthand like 12k.' },
          { title: 'Work the board', body: 'Drag deals forward, schedule the next step on each, and let the Activities list tell you what is due today.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'The deal assistant',
        paragraphs: [
          'Every open deal gets a health score from the signals a sales manager checks by eye: is there a next step, is it overdue, has anyone touched the deal lately, has the close date slipped, is there a contact person.',
          'From those it suggests the next best step for the deal’s stage — a discovery call, a demo, the proposal, the follow-up — and schedules it in one click. It also drafts a stage-appropriate follow-up email.',
          'The assistant runs in your browser on your own data; nothing is sent anywhere. For open-ended coaching, Copy AI coaching prompt packages the deal’s context for whichever AI assistant you already use.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Stages, deals, people, activities, notes and automations, each in its own table keyed by id, with indexes by stage, owner, status, contact and deal.',
          'All of it in one app on attested Calimero nodes, which apply every change in one ordered log: two people editing the same deal leave the later edit.',
          'Money as whole units of the pipeline currency, never floats.',
          'Only a deal’s creator can delete it, and only a note’s author can delete the note — enforced in the contract, not the UI.',
        ],
      },
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A stage will not delete', def: 'It still has open deals. Move them to another stage, or close them, first.' },
          { term: 'A deal cannot be dragged', def: 'Closed deals leave the board. Reopen it from its page to put it back in the stage it closed from.' },
          { term: 'You cannot delete a deal', def: 'Only the person who created it may delete it. Anyone in the workspace may move, edit, win or lose it.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A pipeline of stages', body: 'Five columns, each with its count, value and weighted forecast: the board every member of the workspace sees.' },
      { title: 'A deal moves', body: 'A move is one call; the board updates for everyone watching.' },
      { title: 'A follow-up appears', body: 'Entering Proposal fired an automation, and the owner now has “Send the proposal” due tomorrow.' },
      { title: 'The assistant flags a deal', body: 'No activity in three weeks and a slipped close date: the card is marked rotting, with the next step one click away.' },
    ],
  },

  'mero-forms': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'A workspace holds your team’s forms. Each form has its questions, and each answer a respondent gives is checked against the question it answers.',
        ],
        concepts: [
          { term: 'Organization', def: 'Who can reach the workspace. Being in it is not being on the team: only the team reads responses.' },
          { term: 'Workspace', def: 'One Calimero app instance in the organization, holding the forms, their responses, the team and the form key register.' },
          { term: 'Form', def: 'A title, a description and a list of questions, open or closed to new responses. A form with responses can be closed but not deleted.' },
          { term: 'Question', def: 'A kind (short answer, paragraph, email, phone, number, website, date, multiple choice or checkboxes), a label, help text, whether it is required, and choices where it has them. Its id is what a website sends the answer under.' },
          { term: 'Response', def: 'Every answer to a form, as sent, with each question’s label and kind at the time, where it came from and who sent it.' },
          { term: 'Form key', def: 'An API key of an admin’s account, limited to this workspace and registered with one form. A website’s backend answers with it; it can do nothing else.' },
          { term: 'Team', def: 'The admins and the people they add. Only the team builds forms and reads responses; only admins issue form keys.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Sign in', body: 'Press Sign in and use a passkey, or create an account with a new one.' },
          { title: 'Start a workspace', body: 'Name it for your team. You are its first admin; invite teammates and add them to the team from Team.' },
          { title: 'Build a form', body: 'Start from Contact us, Request a demo or Feedback, or a blank form, and add the questions you need.' },
          { title: 'Collect responses', body: 'Share a public link, issue a form key for your website from the form’s Connect tab, or enter a response by hand from Preview.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Your website, and Mero CRM',
        paragraphs: [
          'An admin issues a form key from the form’s Connect tab: an API key, approved with their passkey, that reaches only this workspace’s two website methods and is registered with the form. The app shows its environment variables once for the website’s backend, which calls the workspace with it.',
          'Revoking a key revokes the API key and its registration, and the website stops being able to send.',
          'Link a form to a Mero CRM pipeline you can reach, choose the stage new deals start in and which question fills the name, email, phone and organization. Send to CRM then makes a contact (reusing one with the same email), a deal, and a note with every answer.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Responses in a map keyed by id, insert-only: the contract refuses an id that exists and nothing else writes them.',
          'Forms, the team’s marks on responses (archived, the CRM deal it became) and the workspace name, which only the team can write: the contract checks every call.',
          'The form key register, which only admins can write. The API key is what lets a website call; the register is what binds it to one form.',
          'All of it in one app on attested Calimero nodes, which apply every change in one ordered log.',
          'Every answer checked against its question before it is stored, and stored with the question’s label and kind so it reads the same after the form changes.',
        ],
      },
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A website’s response is refused', def: 'An answer does not fit its question (an option the form does not have, a required question left blank), the form is closed, or the key was issued for another form.' },
          { term: 'Send to CRM offers no pipeline', def: 'Your account does not reach a Mero CRM pipeline yet. Join its organization from an invite link, or paste its id in the Connect tab.' },
          { term: 'A form will not delete', def: 'It has responses. Close it instead, so nothing anyone sent disappears.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A form takes shape', body: 'Questions of the kinds you need, each with its own id, in a builder that reads like the form it makes.' },
      { title: 'A website answers', body: 'The site’s backend sends the response with its form key, and the contract checks every answer.' },
      { title: 'The responses add up', body: 'The choice questions summarise themselves, and every response is one row, kept exactly as it was sent.' },
      { title: 'One goes to the CRM', body: 'Send to CRM makes a contact and a deal in the pipeline, with every answer in a note on it.' },
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
          { term: 'Workspace', def: 'A team: an organization whose members are the people who can see and triage its boards.' },
          { term: 'Repository', def: 'One board in the workspace, named after the repo it tracks: its issues, comments, labels and the repo URL.' },
          { term: 'Issue', def: 'Title plus summary, impact, repro steps and resolution criteria, with a status, a priority, an assignee and labels.' },
          { term: 'Label', def: 'A row keyed by issue and label together, which is why adding the same label twice leaves one label, not two.' },
          { term: 'MCP server', def: 'A Model Context Protocol server exposing the board, so an AI coding agent can read an issue and its context directly rather than being pasted a screenshot.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Sign in', body: 'Press Sign in and use a passkey, or create an account with a new one.' },
          { title: 'Create a workspace', body: 'A workspace you own, then a repository in it.' },
          { title: 'File an issue', body: 'Fill in summary, impact, repro and resolution criteria. The structure is the point: it is what makes the issue usable by someone who is not you.' },
          { title: 'Triage together', body: 'Invite your team from Members. Status, priority, assignee and labels are editable by any member, and everyone sees the board move.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Working with an agent',
        paragraphs: [
          'Any issue can be rendered as a prompt for a coding agent in one click, carrying the four sections as written.',
          'For a tighter loop, the MCP server exposes the board directly, with an agent key you create on the Members page, so an agent can list issues and read one without a human relaying the text.',
          'Authorship is enforced in the contract: only the author of a comment may edit or delete it, and only the creator of an issue may delete it.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Issues, keyed by id, with indexes by status, assignee and creation time, and a maintained count per status.',
          'Comments, each carrying its author.',
          'Labels, one row per issue and label.',
          'The repository URL for the board, if one is set.',
          'All of it in one app on attested Calimero nodes, which apply every change in one ordered log.',
        ],
      },
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A label appears twice', def: 'It should not: a label is keyed by issue and label together. If you see a duplicate, the two differ by case or whitespace.' },
          { term: 'Your edit was replaced', def: 'Two people rewriting the same field leave the later write; edits to different fields both survive.' },
          { term: 'You cannot delete an issue', def: 'Only the person who filed it may delete it. Anyone may change its status, priority, assignee and labels.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'Four columns', body: 'Open, in progress, blocked, done: the board every member of the workspace sees.' },
      { title: 'A card moves', body: 'A status change is one call; the board updates for everyone watching.' },
      { title: 'A teammate moves one back', body: 'The calls are ordered: the later status holds, and every other field is untouched.' },
      { title: 'An agent reads it', body: 'The same issue is available over MCP, so a coding agent gets the repro steps as written.' },
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
          { term: 'Team', def: 'A Calimero organization you own and invite collaborators into.' },
          { term: 'Project', def: 'One document, an app instance in the team: its canvas size, its layers, its members and their cursors.' },
          { term: 'Layer', def: 'A record in a map keyed by layer id — raster, text or fill. Content, mask, transform and adjustments are separate fields, so painting on a layer does not conflict with moving it.' },
          { term: 'Adjustment', def: 'Non-destructive. Brightness, contrast, saturation, hue, exposure, blur and invert are stored as parameters and applied at render time, so the pixels underneath are never rewritten.' },
          { term: 'Owner / editor', def: 'The document name and size are owner-gated: a rename from a non-owner is refused by the contract, not merely hidden.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Sign in', body: 'Press Sign in and use a passkey, or create an account with a new one.' },
          { title: 'Create a document', body: 'Choose a canvas size. You are the owner.' },
          { title: 'Work in layers', body: 'Add raster, text and fill layers, group them in folders, and reorder freely.' },
          { title: 'Invite editors', body: 'Grant the editor role. Everyone else can watch the document change without being able to change it.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Working together',
        paragraphs: [
          'Because each layer is its own record with separate fields, two people working on different layers never contend, and two people doing different things to one layer, one painting and one transforming, usually do not either.',
          'Cursors are kept apart from the layers, so watching someone move never touches the artwork.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Canvas size and background.',
          'Layers, keyed by id, with content, mask, transform, adjustments and text as separate fields.',
          'Members and their usernames, plus roles.',
          'Cursors, one per person.',
          'Pixels and masks as PNG blobs of the document; the layers name them by id.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A layer jumped back', def: 'Two people moved the same layer. The transform is one field and the later move wins; the pixels are untouched.' },
          { term: 'An adjustment looks different on their screen', def: 'Adjustments render from parameters, so a difference means their screen has not re-read the layer yet. It catches up with the next change.' },
          { term: 'You cannot edit', def: 'You hold the viewer role. Ask the owner for editor.' },
        ],
      },
    ],
    previewSteps: [
      // The hero is interactive (animation.tsx), so these are things to try, in order.
      { title: 'Paint on the canvas', body: 'Pick a colour and drag, or use the arrow keys and Space. The stroke lands on the layer you have selected.' },
      { title: 'Ada draws at the same time', body: 'Your teammate paints on her own layer. Neither of you waits for the other, because every layer is a separate record.' },
      { title: 'Hide a layer', body: 'Each eye hides one layer and leaves the others exactly as they were.' },
      { title: 'Tune the hue', body: 'The slider is an adjustment on the selected layer: stored as a setting, so Reset brings the original pixels straight back.' },
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
          { term: 'Workspace', def: 'An organization you own and invite collaborators into.' },
          { term: 'Workbook', def: 'One app instance in the workspace: its sheets and its cells.' },
          { term: 'Sheet', def: 'A tab. Stored as a record; a workbook can hold several.' },
          { term: 'Cell', def: 'One entry in a map keyed by sheet and coordinate. Value, formula and format are separate, so formatting a cell does not fight with typing in it.' },
          { term: 'Cursor', def: 'Where each collaborator is and what they have selected, in their own colour. Live presence, never stored in the workbook.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Sign in', body: 'Sign in with a passkey, or create an account with a new one. There is no password and no email.' },
          { title: 'Create a workbook', body: 'Your first one creates a workspace you own, with the workbook in it.' },
          { title: 'Type something', body: 'Enter values, or a formula: 94 functions are built in, from SUM and IF to XLOOKUP and TEXT, with autocomplete and inline help.' },
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
          'Not stored: cursors and selections. They travel on the app\'s presence channel and vanish when you close the sheet.',
        ],
      },
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A total looks wrong', def: 'Totals are computed locally from the raw formula. A wrong total means a referenced cell has not been read yet; it corrects itself with the next update.' },
          { term: 'Your formatting was lost', def: 'Value, formula and format are separate fields. Losing formatting but keeping the value means someone reformatted the same cell, not that the write failed.' },
          { term: 'A collaborator’s cursor is stuck', def: 'Presence stopped, not their edits. Cells keep updating regardless.' },
        ],
      },
    ],
    previewSteps: [
      // Beats of the recorded hero loop (public/landing/hero.webm), in order.
      { title: 'Two people, one workbook', body: 'You and Ada have the same Q3 budget open. Her cursor is on Travel.' },
      { title: 'You fill in a number', body: 'You type Travel for Q2, and its row and column totals recompute.' },
      { title: 'She edits at the same time', body: 'Ada walks up to Wages and changes Q3 while you type. Neither waits for the other.' },
      { title: 'Every total agrees', body: 'Formulas are stored raw and recomputed from the latest cells, so both totals reflect both edits.' },
    ],
  },

  'mero-sign': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'An e-signature workflow with no signing service in the middle. An agreement is an app instance you administer, and your signature library is a separate, private one only you can open.',
        ],
        concepts: [
          { term: 'Workspace', def: 'An organization: the people you sign with. Invitations are to a workspace.' },
          { term: 'Agreement', def: 'An app instance in the workspace: its documents, participants and signature records. You create it, and you administer who signs.' },
          { term: 'Signature library', def: 'An app instance only you are in, so the signatures you have drawn are visible to nobody else — including the people you sign agreements with.' },
          { term: 'Participant', def: 'Someone on the agreement’s roster, in a role you assign. Participation is recorded in the contract, not just in the interface.' },
          { term: 'Consent', def: 'An explicit, recorded agreement to sign electronically, stored alongside the signature record.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Sign in', body: 'Sign in with a passkey, or create an account with a new one. There is no password and no email.' },
          { title: 'Create a workspace and an agreement', body: 'An agreement you administer, in a workspace you own. Upload the PDF that needs signing.' },
          { title: 'Invite people', body: 'Share the workspace link, approved with your passkey, and assign roles once they have joined.' },
          { title: 'Sign', body: 'Signatures are drawn from your private library and recorded against the document as a new version.' },
        ],
      },
      {
        id: 'sharing',
        heading: 'Inviting signatories',
        paragraphs: [
          'An invitation admits someone to the workspace, approved with your passkey, and can land them straight in an agreement. Joining an agreement makes them a signer unless you set another role.',
          'A signature is accepted only on the version the document is at, so two people signing at once can never erase each other’s mark.',
        ],
      },
      {
        id: 'storage',
        heading: 'What is stored, and where',
        bullets: [
          'Documents uploaded to the agreement as files of that agreement, and every signed version of them.',
          'Participants, their roles, and their recorded consent.',
          'Your signature library, in a private instance nobody else can open.',
        ],
      },
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'A signatory cannot sign', def: 'They must be on the agreement’s roster as a signer or admin. Being a member of the workspace is not the same as being a signatory.' },
          { term: 'Someone signed while you were signing', def: 'Your copy is refused rather than erasing their mark. Reopen the document and sign again.' },
          { term: 'The invite link does nothing', def: 'An invitation is redeemed once, after you sign in. Ask for a fresh one rather than reusing an old link.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'A document to sign', body: 'The PDF lives in the agreement, readable only by the people in its workspace.' },
      { title: 'Fields fill in', body: 'Each signature is recorded against the document with its signer and role.' },
      { title: 'Consent is recorded', body: 'Agreeing to sign electronically is stored with the signature, not assumed.' },
      { title: 'Every version kept', body: 'Each signature records the version it signed and the one it produced.' },
    ],
  },

  'mero-stream': {
    docs: [
      {
        id: 'concepts',
        heading: 'The words, and what they mean here',
        paragraphs: [
          'Mero Stream is a capacity probe, not a finished product, and this page would rather say so than oversell it. It exists to find out how far live media can be pushed through a Calimero app, and to report the answer honestly.',
        ],
        concepts: [
          { term: 'Stream', def: 'An organization you own and invite people into. Everyone in it reaches every room.' },
          { term: 'Room', def: 'One app instance in the stream: one call, with its members, its frames and its chunks.' },
          { term: 'Frame', def: 'A picture encoded by a deterministic, integer-only codec running inside the app component. No floating point, no SIMD, no threads — so every reader decodes a byte-identical result.' },
          { term: 'Chunk', def: 'The other path: H.264 encoded by the browser’s WebCodecs and stored as fragments. Faster, but the browser is doing the encoding rather than the contract.' },
          { term: 'Presence', def: 'The node\u2019s ephemeral channel: what the call carries its video on. Never stored, never in the app\u2019s log, gone 7 seconds after the last update.' },
        ],
      },
      {
        id: 'start',
        heading: 'Getting started',
        steps: [
          { title: 'Use a browser', body: 'This app is web only: it needs WebCodecs and a camera.' },
          { title: 'Sign in', body: 'Sign in with a passkey, or create an account with a new one. There is no password and no email.' },
          { title: 'Create a stream', body: 'An organization you own, then a room in it. Invite people with a link, approved with your passkey.' },
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
          'Each room\u2019s members and the names they joined with. The stream\u2019s owner is the room\u2019s admin.',
          'Frames from the deterministic codec, with a sequence number and a checksum.',
          'Media chunks from the WebCodecs path, with cursors marking keyframes.',
          'Pruning counters, so old frames can be dropped without breaking the monotone sequence. Never the call\u2019s video: that rides presence.',
        ],
      },
      OFFLINE,
      {
        id: 'trouble',
        heading: 'When something looks wrong',
        concepts: [
          { term: 'Frames are dropping', def: 'Expected, and the point. The app reports what got through rather than pretending everything did.' },
          { term: 'The camera does not start', def: 'WebCodecs H.264 needs a browser build that ships the codec. A stock Chromium without it will not encode.' },
          { term: 'Nobody sees my video', def: 'Each presence update is at most 4 KiB, so a keyframe is a dozen of them; a slow link drops frames until the next keyframe. The data panel shows what got through.' },
        ],
      },
    ],
    previewSteps: [
      { title: 'Two people', body: 'An encoder and a decoder, with a real Calimero app between them rather than a media server.' },
      { title: 'Frames flow', body: 'Either deterministic frames computed inside the app component, or browser-encoded H.264 chunks.' },
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
          { title: 'Sign in', body: 'Press Sign in, or create a passkey account, when you want to share a world.' },
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
          'Players and their positions, refreshed by heartbeat; each player\'s row is theirs alone to write.',
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
