# @calimero-apps/glass

The fleet's shared light-glass look, as one stylesheet: the same look Hyperfeed and the generated
landing pages (`scripts/landing/template`) use.

- A cool off-white ground with soft colour fields behind everything, tinted per app.
- Frosted, translucent surfaces for the frame: headers, sidebars, toolbars, panels, cards.
- One near-black ink for primary controls, pill-shaped buttons, Figtree throughout.
- The blue, violet and pink brand gradient for marks and for anything an assistant prepared.

It is plain CSS because the apps style four different ways (styled-components, CSS modules,
Tailwind, plain CSS) and all of them can import a stylesheet. Every name is a `--glass-*` custom
property or a `glass-` class, so nothing collides with an app's own.

## Adopting it in an app

1. Add `"@calimero-apps/glass": "workspace:*"` to the app's `dependencies` and import the
   stylesheet once, first, in the app's entry: `import '@calimero-apps/glass/glass.css';`
2. Set the app's tint on `:root` in its own stylesheet, from its icon colour:
   `:root { --glass-tint: #ffc93c; }` (the same value as `TINTS` in
   `scripts/landing/generate.mjs`).
3. Map the app's OWN tokens onto glass values (`--bg: var(--glass-ground)`,
   `--surface: var(--glass-surface)`, `--text: var(--glass-ink)`, its primary-button colour onto
   `--glass-ink`, its radii up). Change values, not names: every component keeps its classes, so
   behaviour and tests do not move.
4. Give the page background `glass-fields` (or the same three declarations in the app's body
   rule), and the app header the floating look (`glass-header`, or its declarations).
5. Restyle the frame, not the content.

## The rules

- **Glass for the frame, not the content.** Grids, documents, canvases, code and long text stay
  solid and sharp; only the chrome around them is frosted.
- **Solid when it floats.** Menus, popovers, dialogs and dropdowns over content use
  `glass-float` (opaque). Nested blur paints in the wrong order and lets the content behind bleed
  through the text.
- **Frost means private.** Private events, sealed ballots and secrets may sit behind heavier frost
  until opened.
- **Light first.** Every app opens light. Dark stays available through the app's own switch;
  `:root[data-theme='dark']`, `:root.dark` and `[data-glass-theme='dark']` all switch the tokens.
- **No behaviour changes.** A migration changes how an app looks, never what it does. Its tests
  must pass unchanged, except assertions that read a colour this look replaces.
