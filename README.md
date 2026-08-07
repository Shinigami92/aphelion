# Aphelion

A live, physically accurate model of the solar system that runs entirely offline.

The Sun, eight planets, five dwarf planets, **all 459 named satellites**, 221
catalogued minor planets and ~74,000 belt particles, positioned from real
ephemerides at any moment you choose — with a UTC clock you can pause, reverse,
scrub and set by hand.

No network requests at runtime. No third-party APIs. Open it on a plane.

**Live: [shinigami92.github.io/aphelion](https://shinigami92.github.io/aphelion/)**

---

## Quick start

```bash
pnpm install
pnpm dev            # http://localhost:5173
```

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

```bash
pnpm validate       # 53 astronomy checks (no browser needed)
pnpm typecheck
pnpm build
```

---

## Controls

Everything has both a pointer gesture and a key.

**Moving around**

| Input | Action |
| --- | --- |
| drag | orbit the focused body |
| scroll / pinch | zoom |
| shift-drag, right-drag | pan |
| `W` `A` `S` `D` | orbit and zoom (fly, in free mode) |
| arrows | orbit |
| `+` / `−` | zoom |
| `Shift` / `Alt` | move faster / finer |
| `V` | toggle orbit ↔ free flight |
| `Q` `E` / `R` `F` | roll / up-down (free mode) |
| `C` | point the free camera back at the focus |

**Time**

| Input | Action |
| --- | --- |
| `Space` | pause / resume |
| `J` / `L` | run backwards / forwards |
| `[` / `]` | slower / faster (1 sec/s up to 100 years/s) |
| `,` / `.` | step one unit back / forward |
| `N` | jump to now, real-time |
| click the clock | type an exact UTC date and time |

**Selection and display**

| Input | Action |
| --- | --- |
| click / double-click | select / select and fly to |
| `Tab` | next planet |
| `1`–`9`, `0` | Mercury…Pluto, the Sun |
| `/` | search all 687 bodies |
| `Home` | frame the whole system |
| `T` | true ↔ explore scale |
| `O` `M` | cycle orbit lines / labels |
| `B` `K` `I` | belts / rings / atmospheres |
| `P` | render quality |
| `H` or `?` | keyboard map |

---

## Sharing a view

The URL always describes what you are looking at, so copying it from the address
bar is all it takes to send someone the exact view — same body, same instant,
same angle. A reload restores it too, rather than resetting to Earth.

```
?t=2024-04-08T18:17:16Z&focus=earth&mode=true&rate=-86400&paused=1
 &az=3.877&el=0.3&d=25.4&orbits=all&labels=all&belts=0
```

| Parameter | Meaning |
| --- | --- |
| `t` | UTC instant, `YYYY-MM-DDTHH:MM:SSZ` |
| `focus` | body key the camera orbits, e.g. `earth`, `moon:Io`, `sb:Vesta` |
| `sel` | selected body, only when it differs from the focus |
| `mode` | `explore` (default) or `true` |
| `rate` | signed simulated seconds per real second; `-86400` is a day per second, backwards |
| `paused` | `1` when the clock is held |
| `az`, `el` | camera azimuth and elevation about the focus, radians |
| `d` | camera distance **in radii of the focused body** |
| `orbits`, `labels` | `none` / `planets` / `all` and `none` / `major` / `all` |
| `belts`, `rings`, `atmo`, `milkyway`, `minor`, `orrery` | `0` to switch a layer off |

Two details worth knowing. Distance is stored in *body radii* rather than
kilometres, so a link frames its subject identically whether the recipient lands
in explore or true scale. And only non-default values are written, so the URL
stays short and readable — render quality is deliberately **not** shared, since it
depends on the viewer's hardware, not the view.

Anything unparseable is ignored rather than fatal: a truncated or hand-edited
link still opens, just with fewer things restored.

---

## The two scale models

The solar system is mostly vacuum. At true scale, if Earth is one pixel the Sun
is 108 pixels away and Neptune is 3,200 — you cannot see an orbit and a planet in
the same image.

So there are two models, and **both preserve every angle and direction exactly**.
Only radial distances and body radii are remapped, so the view is never wrong
about *where* anything is, only about how far away it is.

- **True** — 1:1. Metrically honest, and genuinely humbling.
- **Explore** (default) — bodies enlarged by a constant factor, so relative sizes
  stay true; heliocentric distances compressed by a power law; satellite
  distances compressed in units of the parent's radius so each moon system stays
  visible around its enlarged planet. Both power laws are monotone, so if A is
  further out than B, it still is after remapping.

Press `T` to cross-fade between them.

---

## How accurate is it?

Positions come from real theory, not from decoration:

- **Planets** — JPL's Keplerian elements with secular rates (Standish), accurate
  to roughly an arcminute over 1800–2050.
- **The Moon** — the full 60-term Meeus/ELP-2000 abridgement, ~10 arcseconds.
- **459 satellites** — JPL published mean elements, including the local Laplace
  plane each inner moon's angles are referred to, plus apsidal and nodal
  precession.
- **221 minor planets** — Minor Planet Center osculating elements.
- **Orientation** — IAU pole and prime-meridian models; satellites oriented from
  tidal locking, which is what tidal locking physically means.

### An end-to-end check

Set the clock to the total solar eclipse of 8 April 2024, 18:17:16 UTC, and the
model reproduces it:

| Quantity | Aphelion | Published |
| --- | --- | --- |
| Sub-solar point | 7.59°N, 93.82°W | 7.6°N, 93.85°W (geometry) |
| Moon–Sun geocentric separation | 0.3497° | 0.348° (from γ = 0.3432) |
| Moon distance | 359,805 km | ~359,800 km |
| Umbra centre | 24.5°N, 105.0°W | 25.3°N, 104.1°W (NASA) |

The umbra lands within about 130 km of NASA's published point of greatest
eclipse — and it is *rendered*, not annotated: the dark spot appears over western
Mexico because the shader computes what fraction of the Sun's disc the Moon
covers at every pixel.

`pnpm validate` runs 44 further checks — Kepler solver residuals, orbital periods,
inclinations, lunar perigee/apogee bounds, nodal crossings, leap seconds and
calendar round-trips.

Read [ATTRIBUTION.md](./ATTRIBUTION.md) for exactly which parts are measured,
which are estimated, and which are synthesised. Two things worth knowing up
front: the dwarf planet surfaces are artistic (no resolved maps exist), and ~450
small bodies have procedurally synthesised surfaces, all labelled as such in the
UI.

---

## What the renderer actually does

- **Analytic shadows, no shadow maps.** Shadow maps cannot span from a ring
  particle to Neptune. Eclipses are solved in closed form — each body is handed
  its four most significant occluders and computes the exact circle-circle
  overlap of the Sun's disc, which is why you get real penumbras, and why annular
  and total eclipses differ correctly. Saturn's rings shadow the planet and the
  planet shadows the rings by ray-plane and ray-sphere tests.
- **Eclipse geometry in kilometres.** The occlusion math runs in true
  body-centred km, not scene units, so shadows stay geometrically exact even
  when explore mode has enlarged the bodies.
- **Single-scattering atmospheres.** Rayleigh + Mie integrated along the view ray
  in the fragment shader, which is what produces the blue limb, the reddened
  terminator and correct forward-scattering haze.
- **Floating origin.** Everything hangs off one group positioned at the negation
  of the focused body, so the focus sits at render-space zero and float32
  precision is spent where the camera is. Without it you cannot stand on a moon
  of Neptune.
- **Belts on the GPU.** Each particle carries its own orbital elements and Kepler
  is solved in the vertex shader, which is what makes ~74,000 independently
  orbiting bodies affordable.
- **Tiered bodies.** The Sun, planets, dwarf planets and moons above 60 km get
  textured spheres; the other ~600 live in one point cloud and are *promoted* to
  real geometry on approach. Procedural surfaces are synthesised lazily, one per
  frame, only for bodies that actually get big enough to show one.

---

## Layout

```
src/
  astro/      pure astronomy — no Three.js, independently testable
    kepler.ts       Kepler's equation, elements → state vectors
    planets.ts      JPL Keplerian planetary theory
    moon.ts         Meeus/ELP-2000 lunar theory
    frames.ts       ecliptic / equatorial / Laplace frames, IAU orientation
    timescales.ts   UTC ↔ JD ↔ TT, leap seconds, ΔT, calendar
  core/
    time.ts         the clock: rates, pause, reverse, scrub
    system.ts       the body tree; solves ~690 positions per frame
    scale.ts        the two scale models
  data/
    bodies.ts       physical properties, rings, atmospheres, facts
    belts.ts        statistical belt generation
    generated/      committed output of scripts/fetch-assets.ts
  render/
    materials.ts    every shader
    scene.ts        scene assembly, LOD, floating origin, picking
    procedural.ts   synthesised surfaces
    textures.ts     lazy loading with procedural fallback
  controls/camera.ts
  ui/               panels, orrery mini-map, styles
scripts/
  fetch-assets.ts       the only networked code in the project
  convert-textures.sh   TIFF → JPEG via sips or ImageMagick
  validate-astro.ts     pnpm validate
```

`window.aphelion` exposes the running simulation (`time`, `system`, `camera`,
`goTo`, `subPoint`) so a flythrough or a check can be scripted from the console.

---

## Known limitations

- The planetary theory is a Keplerian fit; precision degrades smoothly outside
  1800–2050, and the UI says so when you scrub beyond it.
- Small satellite orbits are propagated from mean elements with linear apsidal
  and nodal precession — good to arcminutes, not the arcseconds a full numerical
  integration would give.
- The Milky Way backdrop is a panorama mapped onto the sky sphere; it is not
  oriented to true galactic coordinates.
- Illumination falloff is compressed rather than inverse-square (see
  ATTRIBUTION.md).
- No general relativity, no light-time correction, no nutation.

---

## Licence

Project code: MIT.

Third-party data and imagery keep their own licences — in particular the Solar
System Scope textures are CC BY 4.0 and **require attribution**. See
[ATTRIBUTION.md](./ATTRIBUTION.md).
