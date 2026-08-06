# Attribution and data provenance

Aphelion is assembled almost entirely from public scientific data. This file
records where every number and every pixel came from, and — just as importantly —
which parts are **not** measurements.

Nothing here is fetched at runtime. `scripts/fetch-assets.ts` downloads these
sources once; the derived textures and generated data modules live in the project
tree (and should be checked in) so the application runs with no network access at
all.

---

## Imagery

### Solar System Scope — planetary and dwarf planet maps

**Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)** — attribution required.

> Textures by [Solar System Scope](https://www.solarsystemscope.com/textures/)
> (©&nbsp;INOVE, Bratislava), used under CC BY 4.0. Their maps are themselves
> based on NASA elevation and imagery data.

Files derived from this source: `sun.jpg`, `mercury.jpg`, `venus_surface.jpg`,
`venus_atmosphere.jpg`, `earth_day.jpg`, `earth_night.jpg`, `earth_clouds.jpg`,
`earth_normal.jpg`, `earth_specular.jpg`, `moon.jpg`, `mars.jpg`, `jupiter.jpg`,
`saturn.jpg`, `saturn_ring.png`, `uranus.jpg`, `neptune.jpg`, `ceres.jpg`,
`eris.jpg`, `haumea.jpg`, `makemake.jpg`, `milkyway.jpg`, `starfield.jpg`.

**Important caveat.** Solar System Scope publishes the Ceres, Eris, Haumea and
Makemake maps as *fictional* — they are artistic impressions, because no
resolved global map of those bodies exists. Aphelion uses them and labels the
affected bodies "surface synthesised" in the info panel. Treat those four
surfaces as illustration, not observation.

### USGS Astrogeology — global mosaics

**Licence: public domain** (US Government work, derived from NASA mission data).

| Body | Source mosaic | Instruments |
| --- | --- | --- |
| Io | `Io_GalileoSSI-Voyager_Global_Mosaic_1km` | Galileo SSI + Voyager, 1 km/px |
| Europa | `Europa_Voyager_GalileoSSI_global_mosaic_500m` | Voyager + Galileo SSI, 500 m/px |
| Ganymede | `Ganymede_Voyager_GalileoSSI_global_mosaic_1km` | Voyager + Galileo SSI, 1 km/px |
| Callisto | `Callisto_Voyager_GalileoSSI_global_mosaic_1km` | Voyager + Galileo SSI, 1 km/px |
| Enceladus | `Enceladus_Cassini_mosaic_global_110m` | Cassini ISS, 110 m/px |

Courtesy NASA / JPL-Caltech / USGS Astrogeology Science Center. Downloaded as
GeoTIFF and downsampled to 4096 px wide.

### USGS Astropedia — global mosaics for the most-visited small bodies

**Licence: public domain** (US Government work, derived from NASA mission data).

| Body | Source | Instruments |
| --- | --- | --- |
| Pluto | `pluto_new_horizons_lorri_mvic_global_mosaic_300m` | New Horizons LORRI + MVIC, 300 m/px |
| Charon | `charon_new_horizons_lorri_mvic_global_mosaic_300m` | New Horizons LORRI + MVIC, 300 m/px |
| Phobos | `phobos_mars_express_src_global_mosaic_12m` | Mars Express SRC + Viking, 12 m/px |
| Triton | `triton_voyager_2_global_color_mosaic_600m` | Voyager 2 colour, 600 m/px |
| Tethys | `tethys_cassini_global_mosaic_293m` | Cassini ISS, 293 m/px |
| Dione | `dione_cassini_voyager_global_mosaic_154m` | Cassini + Voyager, 154 m/px |
| Rhea | `rhea_cassini_voyager_global_mosaic_417m` | Cassini + Voyager, 417 m/px |
| Iapetus | `iapetus_cassini_voyager_global_mosaic_803m` | Cassini + Voyager, 803 m/px |
| Vesta | `vesta_dawn_fc_hamo_global_mosaic_60m` | Dawn FC HAMO, 60 m/px |

Retrieved as 1024 x 512 browse JPEGs from Astropedia's CKAN store. These are
lower resolution than the Galilean mosaics above; they were chosen because these
bodies are among the first anywhere anyone explores, and real imagery at 1024 px
beats a synthesised surface at any resolution.

**Two honest notes.**

All of these except Triton are **panchromatic** — single-channel greyscale, since
they derive from broadband imaging rather than colour composites. For Charon,
Phobos and Vesta that is faithful: those bodies really are close to neutral grey.

Pluto is the exception, and it gets one deliberate intervention. Its butterscotch
colour is the most recognisable thing about it, so rendering the panchromatic
mosaic raw would misinform as badly as a fake surface. Aphelion multiplies it by a
fixed tint (`textureTint` in `data/bodies.ts`) matching Pluto's measured global
colour. **The detail is real New Horizons data; the hue is applied.** No other body
is tinted.

### Everything else — synthesised

Roughly 450 of the 687 bodies have **no map that has ever been made**; most are
unresolved points of light even to Hubble. Their surfaces are generated
procedurally by `src/render/procedural.ts` from properties that *are* known —
radius, parent, albedo class, whether the body is icy or rocky — producing
plausible crater densities, albedo mottling and polar frost.

These surfaces carry real information but are **not** pictures of those worlds.
The info panel marks every one of them "surface synthesised".

---

## Ephemerides and physical data

### Planetary positions

E. M. Standish, *Keplerian Elements for Approximate Positions of the Major
Planets*, JPL Solar System Dynamics.
<https://ssd.jpl.nasa.gov/planets/approx_pos.html>

Six elements plus linear rates per Julian century for Mercury through Pluto.
Quoted accuracy is on the order of arcminutes over 1800–2050. Public domain.

### The Moon

Jean Meeus, *Astronomical Algorithms*, 2nd ed., chapter 47 — an abridgement of
the ELP-2000/82 lunar theory. Aphelion implements the full 60-term longitude and
radius table, the 60-term latitude table, and the planetary additive terms,
giving roughly 10 arcseconds in longitude. Algorithm used with citation; no code
was copied.

### Satellites — all 459 of them

JPL Solar System Dynamics, planetary satellite mean orbital elements and
physical parameters:

- <https://ssd.jpl.nasa.gov/sats/elem/>
- <https://ssd.jpl.nasa.gov/sats/phys_par/>

Public domain. Provides semi-major axis, eccentricity, inclination, node,
periapsis, mean anomaly, orbital period, apsidal and nodal precession periods,
and — for the inner satellites — the pole of the local Laplace plane the
elements are referred to. The physical-parameters table covers the 46 moons with
a measured GM.

For the remaining satellites, published mean radii are hard-coded in
`scripts/fetch-assets.ts` (`KNOWN_RADII`) from the discovery literature. Anything
still unknown — mostly the recently discovered small outer irregulars — gets a
nominal radius and is flagged `radiusEstimated`, surfaced in the UI as "size
estimated". 325 of the 459 fall into that category, which is an honest
reflection of how little is known about them.

### Minor planets

IAU Minor Planet Center orbit catalogues:

- `MPCORB.DAT` — numbered and unnumbered minor planets
- `Distant.txt` — Centaurs, trans-Neptunian and scattered-disc objects

<https://www.minorplanetcenter.net/iau/MPCORB.html>

Aphelion selects the brightest (hence largest) objects per dynamical family,
yielding 221 bodies with real osculating elements — every dwarf planet and every
major belt, Trojan, Hilda, plutino, classical-Kuiper and scattered-disc
population. Courtesy of the IAU Minor Planet Center.

Diameters for these are derived from absolute magnitude and an assumed
family-typical albedo via the standard relation `D = 1329 / sqrt(p) · 10^(−H/5)`,
so they are estimates, not measurements.

### Body orientation

IAU Working Group on Cartographic Coordinates and Rotational Elements — pole
right ascension/declination, prime meridian `W₀` and rotation rate `Ẇ` for the
Sun, planets and Pluto, hard-coded in `src/data/bodies.ts`.

Satellites are oriented from geometry instead: a tidally locked moon's prime
meridian faces its parent and its pole is the orbit normal. That *is* what tidal
locking means, and it stays correct for all 459 without needing per-moon
constants.

### Time scales

Espenak & Meeus ΔT polynomial fits, as used in NASA's *Five Millennium Canon of
Solar Eclipses*, for dates before the leap-second era. Leap seconds (TAI−UTC)
are tabulated through 2017-01-01 = 37 s in `src/astro/timescales.ts`.

### Belt structure

The ~74,000 background belt particles are **generated, not catalogued**. They are
drawn from the real observed distributions of semi-major axis, eccentricity and
inclination, with the Kirkwood gaps cut at the 4:1, 3:1, 5:2, 7:3 and 2:1
Jupiter resonances, Trojan camps librating about Jupiter's L4/L5, the Hilda group
at the 3:2 resonance, and a Kuiper belt with cold classical, hot classical,
plutino, twotino and scattered-disc components.

Individual particles correspond to no real object. The *structure* is real; the
members are synthetic.

---

## Software

- [three.js](https://threejs.org/) — MIT licence. WebGL rendering.
- [Vite](https://vite.dev/) — MIT licence. Build tooling.
- [TypeScript](https://www.typescriptlang.org/) — Apache 2.0.

All shaders in `src/render/materials.ts` are original to this project.

---

## Summary of what is and is not measured

| Aspect | Status |
| --- | --- |
| Planet positions | Real theory, ~arcminute accuracy 1800–2050 |
| Moon position | Real theory, ~10 arcsecond accuracy |
| Satellite orbits | Real published mean elements, all 459 |
| Minor planet orbits | Real published osculating elements, 221 bodies |
| Rotation / axial tilts | Real IAU values for Sun, planets, Pluto |
| Satellite rotation | Derived from tidal locking (physically correct) |
| Eclipse geometry | Computed from the above; umbra verified to ~130 km |
| Planet / major moon surfaces | Real spacecraft imagery |
| Dwarf planet surfaces | **Artistic** (no resolved maps exist) |
| ~450 small body surfaces | **Synthesised** from known bulk properties |
| Satellite radii | 134 measured, 325 nominal estimates |
| Minor planet diameters | Derived from magnitude + assumed albedo |
| Belt particles | **Generated** from real distributions |
| Illumination falloff | Deliberately compressed (see below) |

One knowing departure from physics: true irradiance falls as 1/r², which renders
Saturn at 1% of Earth's brightness and Neptune at 0.1% — black, on a display that
cannot adapt the way an eye does. Aphelion compresses the exponent to 0.45, which
preserves the ordering and the sense of dimming while keeping every planet
visible. It is the only such compromise in the renderer, and it is confined to
one line in `src/render/scene.ts`.
