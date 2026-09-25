# Contributing to Aphelion

Thanks for your interest in Aphelion! This guide covers how to set up the repo,
the day-to-day scripts, and the expectations for a change to be merge-ready.

---

## Prerequisites

- **Node.js 24.11 or newer.** The scripts under `scripts/` run directly with
  `node file.ts` via type stripping, which is why imports carry explicit `.ts`
  extensions.
- **pnpm** — pinned via `devEngines.packageManager` in `package.json`. Any pnpm
  on your `PATH` downloads and switches to the pinned version on first run, so
  you don't install a specific version by hand. Do not use npm or yarn.
- **Git**.
- **ImageMagick** (or `sips`, built into macOS) — only if you run the asset
  pipeline (see [The asset pipeline](#the-asset-pipeline)).

> [!NOTE]
> The Node requirement is deliberately **not** declared in `package.json`. pnpm
> refuses to switch to the pinned version whenever `engines.node` or
> `devEngines.runtime` is present, so declaring it would break installs for
> anyone whose global pnpm is a different major.

---

## Setup

```bash
# 1. Clone
git clone git@github.com:Shinigami92/aphelion.git
cd aphelion

# 2. Install dependencies
pnpm install

# 3. Start the dev server (http://localhost:5173)
pnpm dev
```

Everything the app needs at runtime is committed, so this works offline.

---

## MCP servers (optional — for AI-assisted development)

`.mcp.json` configures a [Playwright MCP](https://github.com/microsoft/playwright-mcp)
server (Chrome, 1680×1000, isolated profile) so an AI assistant can open the
running app, drive it and take screenshots. Its output lands in
`.playwright-mcp/`, which is gitignored.

Start `pnpm dev`, then point the browser at a view URL — for example the eclipse
end-to-end check, `http://localhost:5173/?t=2024-04-08T18:17:16Z&focus=earth`.
`window.aphelion` exposes the running simulation (`time`, `system`, `camera`,
`goTo`, `subPoint`) for scripting.

---

## Repository layout

```
src/
  main.ts     entry point: builds everything in order and runs the frame loop
  app/        what main.ts wires up: input, panel layout, shared links, frame governor
  astro/      pure astronomy — no Three.js, independently testable
    kepler.ts       Kepler's equation, elements → state vectors
    planets.ts      JPL Keplerian planetary theory
    moon.ts         Meeus/ELP-2000 lunar theory
    frames.ts       ecliptic / equatorial / Laplace frames, IAU orientation
    lagrange.ts     the five equilibria of the restricted three-body problem
    timescales.ts   UTC ↔ JD ↔ TT, leap seconds, ΔT, calendar
  core/
    time.ts         the clock: rates, pause, reverse, scrub
    system.ts       the body tree; solves ~690 positions and 40 points per frame
    scale.ts        the two scale models
  data/
    bodies.ts       physical properties, rings, atmospheres, facts
    belts.ts        statistical belt generation
    stars.ts        the packed star catalogue's format
    generated/      committed output of scripts/fetch-assets.ts
  render/
    materials/      one file per material: uniforms, defines, blending
    shaders/        the GLSL behind them; chunks/ holds the shared #include chunks
    scene.ts        SceneView: builds the scene and runs its layers each frame
    scene/          one file per layer: bodies, rings, orbits, labels, picking, ...
    sky.ts          the star field and the deep-sky backdrop
    procedural.ts   synthesised surfaces
    textures.ts     lazy loading with procedural fallback
  controls/camera.ts
  ui/               panels, orrery mini-map, styles
  sw-register.ts    registers the service worker in production
test/               Vitest unit tests for the pure modules (*.spec.ts)
e2e/                Playwright guards for render/UI refactors: screenshots, pick maps, input (*.e2e.ts)
docs/               long-form documentation linked from the README
public/
  sw.js             offline cache: network-first shell, stale-while-revalidate assets
  manifest.webmanifest
scripts/
  fetch-assets.ts       the only networked code in the project
  convert-textures.sh   TIFF/EXR → JPEG via sips or ImageMagick
  validate-astro.ts     pnpm validate
```

---

## Scripts

| Script           | What it does                                                  |
| ---------------- | ------------------------------------------------------------- |
| `pnpm dev`       | Vite dev server on port 5173                                  |
| `pnpm build`     | production build into `dist/`                                 |
| `pnpm preview`   | serve `dist/` — the only way to exercise the service worker   |
| `pnpm format`    | format everything with oxfmt (`format:check` to only check)   |
| `pnpm lint`      | lint with oxlint, type-aware (`lint:fix` to apply safe fixes) |
| `pnpm ts-check`  | type-check with `tsc`                                         |
| `pnpm test`      | Vitest unit tests (`test:watch` for watch mode)               |
| `pnpm coverage`  | unit tests with a v8 coverage report                          |
| `pnpm validate`  | astronomy reference-value checks against the committed data   |
| `pnpm assets`    | the asset pipeline — the only script that touches the network |
| `pnpm preflight` | everything a PR must pass, in order — run it before you push  |

`pnpm preflight` runs `install`, then `format`, `lint`, `ts-check`,
`test:update-snapshots`, `validate` and `build`. It **writes** formatting and
snapshot changes, so commit whatever it leaves behind.

---

## The asset pipeline

The imagery in `public/textures` (~110 MB), the elevation grids in
`public/shapes`, and the generated ephemeris modules in `src/data/generated` are
kept in the project tree and deliberately **not** gitignored — check them in, and
a fresh clone runs immediately with no network access. Only `.cache/` (the large
intermediate downloads) is ignored.

To re-fetch or refresh them:

```bash
pnpm assets         # downloads sources, converts imagery, regenerates data
pnpm assets:light   # skip the large USGS moon mosaics, 4k instead of 8k
```

`pnpm assets` is the **only** part of the project that touches the network. It
needs `sips` (macOS, built in) or ImageMagick to convert the TIFF sources.

The generated modules in `src/data/generated/` are written by
`scripts/fetch-assets.ts` and are excluded from formatting and linting. Never
edit them by hand; change the script and regenerate.

When you add or change data or imagery, update [ATTRIBUTION.md](./ATTRIBUTION.md)
in the same change: it records the source and licence of everything, and what is
measured versus estimated versus synthesised.

---

## Testing expectations

- **`pnpm test`** is the fast inner loop over the pure logic — the Kepler solver,
  the time scales, the scale remapping, the URL codec. New pure logic gets a
  `test/*.spec.ts`. Tests run shuffled, so they must not depend on each other.
- **`pnpm validate`** is the slower gate that reads published landmarks back out
  of every ephemeris and elevation grid. A change to an ephemeris, a frame or a
  generated table must keep every check green, and a new data source should add
  a check of its own.
- **Visual changes** need a look in a real browser: `pnpm dev`, and a view URL
  that shows the change. Add before/after screenshots to the PR.
- **Service worker and offline behaviour** only exist in production builds. Test
  them with `pnpm build && pnpm preview`, never with `pnpm dev`.

CI runs the tests and `validate` on Node 24 and 26, plus formatting, lint,
type-check and build, on every push and pull request.

---

## Coding guidelines

Formatting is enforced by oxfmt and lint by oxlint — let the tools decide style.
Beyond that, a few rules the whole design depends on:

- **Zero runtime network requests.** Everything is served from the app's own
  origin. Nothing may reach a third party at runtime; data is fetched once, by
  `pnpm assets`, and committed.
- **Units.** Kilometres as float64, radians internally (degrees only at data and
  UI edges), Julian Dates (`jdTT` for dynamics, `jdUTC` for display). One scene
  unit is 1000 km. See `src/core/constants.ts`.
- **`src/astro/` is pure** — no Three.js, no DOM. That is what makes it
  unit-testable; keep it that way.
- **Floating origin.** Everything hangs off a group positioned at minus the
  focused body, so float32 precision is spent near the camera. Eclipse and shadow
  math runs in true body-centred kilometres, not scene units.
- **Both scale models preserve every angle and direction.** Only radial distances
  and radii are remapped, and always monotonically.
- **The URL is the view state.** Only non-default values are written, unparseable
  parameters are ignored rather than fatal, and legacy parameter names keep
  working so old links still open.
- **Honesty about accuracy.** Anything procedural or artistic is labelled in the
  UI and in ATTRIBUTION.md.
- **Comments explain why** — the physics, the trade-off, the thing that went
  wrong without it — in full sentences. The code already says what.

Some oxlint rules are temporarily disabled in `.oxlintrc.json`, each with its
violation count. Re-enabling one (and fixing its violations) is a welcome,
self-contained PR.

---

## Commit convention

Commits and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <subject>
```

Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `infra`,
`ci`, `chore`, `revert`. Write the subject in lowercase and the imperative, from
the user's point of view — `feat: announce the destination when a flight settles
into orbit`. Use the body to explain the problem and why this is the fix. PR
titles are checked automatically.

---

## Opening a pull request

1. Branch off `main`.
2. Make your change, with tests or `validate` checks where they apply, and update
   the README, docs or ATTRIBUTION.md alongside user-visible changes.
3. Run `pnpm run preflight` and commit what it changes.
4. Open the PR with a Conventional Commits title. For visual changes, include
   screenshots and the view URL that shows them.
