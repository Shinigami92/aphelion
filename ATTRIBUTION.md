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
| Mimas | `Mimas_PDS_8ppd_dd360` | Cassini ISS, 8 px/deg |
| Phoebe | `Phoebe_PDS_8ppd_dd360` | Cassini ISS, 8 px/deg |

Courtesy NASA / JPL-Caltech / USGS Astrogeology Science Center. Downloaded as
GeoTIFF and downsampled to 4096 px wide.

Mimas and Phoebe are absent from both the mosaic set and Astropedia; their maps
come instead from the Cassini Imaging Team basemaps that back the USGS map
viewer, credited in the archive to NASA / Cassini Imaging Team. Two differences
from the mosaics: they are **pyramidal** TIFFs, so the conversion selects page 0
or it writes one file per overview level; and their names end `dd360` because
they start at the prime meridian rather than 180° west, so they are rolled half a
turn to sit in the same frame as every other map here. The world files
(`.tfw`) state both facts, and were read rather than assumed.

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
| Eros | `near_msi_albedo_mosaics` | NEAR MSI albedo mosaic, 1024 px |

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

### PDS Geosciences Node — global topography

**Licence: public domain** (US Government work, NASA mission data).

| Body | Source | Instrument |
| --- | --- | --- |
| Mars | `megt90n000cb.img` (MEGDR) | MGS MOLA, 4 px/deg |
| Moon | `ldem_4.img` (LOLA GDR) | LRO LOLA, 4 px/deg |
| Earth | `ETOPO2v2g_i2_LSB` | NOAA ETOPO2v2, 2 arc-min |

- <https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/>
- <https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/>
- <https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2/>

Earth's grid is courtesy NOAA National Centers for Environmental Information and
is block-averaged from 10801 × 5401 down to 2048 × 1024. **Its bathymetry is
deliberately discarded**: over an ocean the visible surface is the water, not the
sea bed, so everything below sea level is clamped to zero before averaging. The
alternative would carve a 270 km trench through the blue Pacific at explore
scale. Clamping before averaging rather than after also means a coastal cell
blends land down to the waterline instead of being dragged under by the sea floor
just offshore, so coastlines have no cliff at the water's edge.

Courtesy NASA / JPL / GSFC. This is measured elevation, not a bump map derived
from imagery: both are 16-bit signed grids — MOLA in metres relative to the
areoid, LOLA in half-metres of radius relative to a 1737.4 km sphere — which
Aphelion resamples into `public/shapes/`, splitting each height across the red
and green channels because browsers decode 16-bit PNGs down to 8 bits. Decoded
ranges are −8.07 to 21.13 km for Mars and −8.88 to 10.50 km for the Moon.

`pnpm validate` checks these against published landmarks rather than trusting
them: Mars's extremes must land on Olympus Mons and Hellas and its northern
lowlands sit below the southern highlands, while the Moon's must land on the
far-side maximum (5.4°N 201.4°E) and Antoniadi inside South Pole–Aitken, with
the far side averaging above the near side. Note the two products differ in byte
order — MOLA is big-endian, LOLA little-endian — which is not something to infer.

### PDS Small Bodies Node — shape models

**Licence: public domain** (US Government work, NASA mission data).

| Body | Source | Form |
| --- | --- | --- |
| Phobos | `phobos_quad128q.tab` (Gaskell) | 6 cube faces × 129² vertices, km |
| Deimos | `m2deimos.tab` (Thomas) | 37 × 73 lat/lon/radius table, 5° grid |
| Mimas | `mimas_quad128q.tab` (Cassini ISS) | cube-quad |
| Tethys | `tethys_quad128q.tab` (Cassini ISS) | cube-quad |
| Dione | `dione_quad128q.tab` (Cassini ISS) | cube-quad |
| Phoebe | `phoebe_quad128q.tab` (Cassini ISS) | cube-quad |
| Eros | `quad128q.tab` (Gaskell, NEAR) | cube-quad |
| Vesta | `4vesta.tab` (Thomas, HST) | lat/lon/radius table, 5° grid |

- <https://sbn.psi.edu/pds/resource/phobosshape.html>
- <https://sbnarchive.psi.edu/pds4/non_mission/ast-sat.thomas.shape-models_V1_0/>
- <https://sbnarchive.psi.edu/pds4/non_mission/gaskell.ast-eros.shape-model_V1_1/>
- <https://sbnarchive.psi.edu/pds3/multi_mission/> (the Cassini `*SHAPE*` archives)

Phobos is 27 × 22 × 18 km and Deimos 15 × 12 × 11 km, so "elevation above a
datum" would be meaningless for either; Aphelion resamples both onto the same
equirectangular grid as the planetary grids above, storing radius offsets from
each body's mean radius. **No exaggeration is applied to either**: the shape is
the shape.

R. Gaskell's Phobos model resamples to 512 × 256 and reproduces its full
8.10–13.94 km radius range. P. Thomas's Deimos model is much coarser — a 5°
grid derived solely from Viking Orbiter imagery, because no other spacecraft has
resolved Deimos properly — so Deimos comes out smooth and correctly shaped rather
than detailed. That is the whole of what has been measured, and Deimos genuinely
is smoother than Phobos, its craters being buried in regolith.

`pnpm validate` reads a published figure back out of every one of these maps
rather than trusting the conversion: the Martian moons' triaxial axes, Herschel
as the deepest point on Mimas, the tidal bulge on Tethys and Dione, Phoebe's 27%
radius spread, Eros's four-to-one elongation, and Rheasilvia leaving Vesta's
southern hemisphere 23 km lower than its northern.

**Two caveats.** Vesta's model is Thomas's HST-derived one, which predates Dawn —
it captures Rheasilvia and the overall figure but not fine detail; no Dawn shape
model is in this archive. And Phoebe rotates every 9.3 hours rather than
synchronously, which Aphelion does not model — it orients every satellite by
tidal locking — so Phoebe has the right shape in the wrong orientation. That was
already true when it was a sphere; the shape makes it easier to notice.

Vesta and Eros also needed measured radii (`SMALL_BODY_RADII`). The
magnitude-and-albedo estimator used for minor planets put Vesta at 384 km against
a real 262.7, and it cannot represent Eros at all — the estimator assumes a
sphere, and Eros is 34 × 11 × 11 km. A shape model's radii are absolute, so the
body's stated radius has to be right or the whole figure inflates.

**Vertical exaggeration is applied at explore scale and is disclosed.** Mars's
entire elevation range is under one percent of its radius and the Moon's is
barely over, so at true scale the relief is real and all but invisible; explore
scale multiplies it (Mars ×12, Moon ×8, Earth ×25 — Earth is the flattest of the
three by a wide margin, 6.4 km of land relief on a 6,378 km radius), in the same
spirit as the sixfold body enlargement that mode already applies. The info panel
names the factor on any body it affects. At true scale relief is 1:1.

One knock-on: Earth's cloud deck nominally sits 0.4% of a radius up, which is
lower than exaggerated Himalaya, so the shell is lifted to clear the highest
terrain. Otherwise the mountains would stand through the clouds.

### PDS Small Bodies Node — Deimos mosaic

**Licence: public domain** (US Government work, NASA mission data).

P. Thomas, `m2deimosm.fit` — a 1440 × 720 Viking Orbiter mosaic, the only global
image of Deimos there is, delivered as a FITS array rather than a browse image.
Aphelion decodes it to `deimos.png`. Before this, Deimos fell back to the
procedural generator, whose oversized craters made it read as a hollow shell.

**Two honest notes.** The mosaic is **high-pass filtered**, so it carries relief
detail but not true albedo — brightness across it is not photometric. And 4.3% of
Deimos was never imaged; those pixels are flattened to the image mean rather than
filled in from their neighbours, so unimaged ground reads as blank instead of as
invented terrain.

The FITS header records no row order. It is read south-first, on the evidence
that the shape model in the same bundle by the same author is explicitly
south-first, and that the unimaged region then lands on the same latitudes *and*
longitudes as that model's unusually smooth southern depression — which is what a
region with no imaging would produce. Read north-first the two would not overlap
at all.

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
| Surface relief | Real measured topography; **exaggerated** at explore scale |
| Phobos and Deimos shapes | Real shape models, unexaggerated |
| Illumination falloff | Deliberately compressed (see below) |

Two knowing departures from physics, both confined and both labelled in the UI.

True irradiance falls as 1/r², which renders Saturn at 1% of Earth's brightness
and Neptune at 0.1% — black, on a display that cannot adapt the way an eye does.
Aphelion compresses the exponent to 0.45, which preserves the ordering and the
sense of dimming while keeping every planet visible. It is confined to one line
in `src/render/scene.ts`.

Surface relief is measured elevation, but at explore scale its vertical scale is
multiplied (Mars by 12) so that terrain under one percent of a planet's radius is
visible at all. True scale renders it 1:1, and the factor in force is stated in
the info panel rather than left for the viewer to guess.
