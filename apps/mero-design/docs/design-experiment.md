# Can a full web app be designed in Mero Design?

**Yes — but not until one two-line bug is fixed.** This is the write-up of an attempt to design a
complete application screen in Mero Design the way you would in Figma, and of the blocker it turned up:
a dependency-semantics change that silently moves **every shape on the canvas by half its own size**.

## What was built

`docs/examples/northwind.mero-design` — an analytics dashboard for a fictional product: top bar with
search and notifications, sidebar with active state and a workspace list, four KPI cards, a twelve-bar
chart with gridlines and axis labels, an activity feed with avatars, and a five-column invoice table
with status chips and row separators.

**134 elements: 37 rects, 13 circles, 84 text.** Nothing else was used, because nothing else works
reliably today (see the workarounds below).

## How it was verified

The design was served to the real app through a mocked node — `get_elements` returns the 134
elements, everything else is stubbed — and rendered by the app's own `FabricCanvas`. The screenshots
are of that canvas, not of a mockup. Then the geometry was checked numerically rather than by eye:
each element's declared `x,y,width,height` was compared against the painted pixels.

## The blocker: every shape is drawn centred on its own origin

The first render was visibly wrong — cards clipped, text detached from the boxes it belonged to — so
the numbers were measured instead of guessed. Two saturated marker squares at opposite corners of the
board plus one uniquely-coloured chip gave this:

| element | declared | painted | offset | size |
| --- | --- | --- | --- | --- |
| marker (top-left) | `100,100 40x40` | `80,80` | **−20, −20** | exact |
| marker (bottom-right) | `1200,700 40x40` | `1180,680` | **−20, −20** | exact |
| "Pending" chip | `712,742 76x22` | `674,731` | **−38, −11** | exact |

Sizes are exact, so this is not a scaling or zoom problem. And the offsets are not uniform, so it is
not a viewport pan either — look at what they actually are:

- marker: 40×40 → offset (−20, −20) = **half its size**
- chip: 76×22 → offset (−38, −11) = **half its size**

Every shape is being painted centred on the coordinate the app intends as its top-left corner.

**Root cause.** `app/package.json` declares `"fabric": "^7.4.0"`, and Fabric v7 changed the default
object origin to **centre**:

```
fabric 7.4.0
new Rect({ left: 100, top: 100, width: 40, height: 40 }).getBoundingRect()
  → { left: 80, top: 80, width: 41, height: 41 }
originX/originY → "center"/"center"
```

Every coordinate in this codebase is computed as a top-left: `FabricCanvas.tsx:499-500` takes
`Math.min` of the drag corners, `PropertiesPanel` edits `x`/`y` as a top-left, and
`buildPrototypeHtml` exports them as CSS `left`/`top`. The renderer is the only part reading them as
centres. The app was written against Fabric v5/v6, where `left`/`top` meant the corner.

**The fix is two lines** — `originX: "left", originY: "top"` on the `base` object and on the text
branch of `buildFabricObject`. With that patch applied, the same probes return:

| element | declared | painted | offset |
| --- | --- | --- | --- |
| marker (top-left) | `100,100 40x40` | `100,100` | **0, 0** |
| marker (bottom-right) | `1200,700 40x40` | `1200,700` | **0, 0** |
| "Pending" chip | `712,742 76x22` | `712,742` | **0, 0** |

and the dashboard renders as designed. The patch was reverted after measuring — it belongs in a PR
with tests, as `PR 1` in [`fix-plan.md`](./fix-plan.md).

### Why this outranks everything in `IMPORTANT.md`

It is the substrate the other bugs sit on, and it plausibly *is* several of them:

- Anything you draw jumps by half its size the moment the store syncs back — which is exactly what
  "line is displayed in the layer but not on the canvas" feels like from the outside.
- Resize handles pull against the wrong anchor, so dragging a text box makes it walk away from the
  cursor — the reported "text object cant be resized up and down".
- Multi-select drag maths compounds the same error per child.

Fixing anything else first means fixing it on a coordinate system that is half a shape out.

Two related v7 changes worth checking in the same PR: the default `freeDrawingBrush` was removed
(which is why the pen tool does nothing — `fix-plan.md` PR 4), and `IText` in v7 **does** ship `mt`/`mb`
controls, so the text-resize bug is the origin problem rather than missing controls.

## Workarounds the design needed

Each of these is a real gap, marked in the generator source:

| Wanted | Had to do | Tracked as |
| --- | --- | --- |
| A 1440×900 frame to design inside | A background rect that happens to be at the back. Nothing clips to it, and there is no notion of "the screen". | `fix-plan.md` item 18, tier 1 |
| Rounded corners on cards, buttons, chips, search field | Hard 90° corners everywhere. This is the single most visible difference from the reference design. | PR 13 |
| Hairline rules for gridlines and table row separators | 1px-tall **rects** — a real line renders invisible today | PR 2 |
| Align/distribute the four KPI cards | Hand-computed `x = 252 + i * 297` in the generator | tier 1 |
| Reusable card component | Copy-paste geometry per card | tier 2 |

## Verdict

The data model is not the limit. 134 elements, twelve distinct colours, four type sizes, chips,
avatars and a table all round-trip through `Element` without strain, and the renderer draws them fast
enough to be interactive at 1:1.

What blocks "design a real app in here" is a short list of specific bugs, in this order: the origin
regression, rounded corners, visible lines, and frames. The first is two lines. The other three are on
the plan.

## Reproducing

```bash
# terminal 1
cd app && pnpm exec vite --port 5199 --strictPort

# terminal 2 — load the design into the app and measure the geometry
node docs/examples/probe-design.mjs      # declared vs painted, per element
node docs/examples/drive-design.mjs      # screenshots the canvas
```

Both scripts mock the node entirely; no `merod` needed.
