# How accurate is it?

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
- **40 Lagrange points** — the five equilibria of each Sun-planet pair, solved
  rather than approximated. See below.

## An end-to-end check

Set the clock to the total solar eclipse of 8 April 2024, 18:17:16 UTC, and the
model reproduces it:

| Quantity                       | Aphelion        | Published                 |
| ------------------------------ | --------------- | ------------------------- |
| Sub-solar point                | 7.59°N, 93.82°W | 7.6°N, 93.85°W (geometry) |
| Moon–Sun geocentric separation | 0.3497°         | 0.348° (from γ = 0.3432)  |
| Moon distance                  | 359,805 km      | ~359,800 km               |
| Umbra centre                   | 24.5°N, 105.0°W | 25.3°N, 104.1°W (NASA)    |

The umbra lands within about 130 km of NASA's published point of greatest
eclipse — and it is _rendered_, not annotated: the dark spot appears over western
Mexico because the shader computes what fraction of the Sun's disc the Moon
covers at every pixel.

## Lagrange points

Each of the eight planets carries the five points where a body of negligible
mass keeps station relative to it and the Sun. Press `X` to switch the layer on
and off; the markers are selectable and flyable like anything else, and
`lagrange:earth:L2` is a valid `focus=` in a shared link.

They are **solved, not approximated.** L4 and L5 are exact — the apexes of the
two equilateral triangles built on the Sun and the planet, which is why they sit
60° ahead of and behind it, and why Jupiter's fall in the middle of the Greek and
Trojan camps the belt swarm already draws. L1, L2 and L3 have no closed form, so
they come out of a bisection on the gradient of the effective potential, which is
the equation that actually defines them. The familiar `a·(µ/3)^(1/3)` Hill-radius
shortcut is only the leading term: it is 0.3% high at Earth and 2.3% high at
Jupiter, and this is the difference between "about a million and a half
kilometres" and the 1.4916 million km that puts SOHO where SOHO is.

The rotating frame is rebuilt from the pair's real geometry every frame — the
instantaneous separation, and the orbit normal from **r** × **v** — so the whole
configuration breathes with the planet's eccentricity and stays in its orbit
plane rather than a nominal ecliptic. Sun–Earth L2 is therefore 1.52 million km
away in July and 1.48 in January, as it is.

Selecting a point tells you which family it belongs to and what that costs: the
collinear three are saddle points, so JWST and SOHO burn fuel to stay; the
triangular two are stable, so material accumulates and never leaves. Pull far
enough back from a planet and the diagram fades in — the line the collinear
points sit on, and the two triangles.

`pnpm validate` runs 159 further checks — Kepler solver residuals, orbital periods,
inclinations, lunar perigee/apogee bounds, nodal crossings, leap seconds and
calendar round-trips, plus a published landmark read back out of every elevation
grid and shape model (Olympus Mons, Hellas, Antoniadi, Herschel, Stickney,
Rheasilvia) so a rolled or flipped map cannot pass unnoticed. The star catalogue
is held to the same standard: ten named stars have to sit at their published
J2000 coordinates, Rigel has to come out blue and Betelgeuse orange, and
Groombridge 1830 has to have moved the 62 arcseconds it really did between the
catalogue's epoch and J2000.

Read [ATTRIBUTION.md](../ATTRIBUTION.md) for exactly which parts are measured,
which are estimated, and which are synthesised. Two things worth knowing up
front: the dwarf planet surfaces are artistic (no resolved maps exist), and ~450
small bodies have procedurally synthesised surfaces, all labelled as such in the
UI.

---

## Known limitations

- The planetary theory is a Keplerian fit; precision degrades smoothly outside
  1800–2050, and the UI says so when you scrub beyond it.
- Small satellite orbits are propagated from mean elements with linear apsidal
  and nodal precession — good to arcminutes, not the arcseconds a full numerical
  integration would give. The distant irregular moons are the exception: the Sun
  perturbs them so strongly that mean elements only keep their orbits' shape and
  orientation roughly right (`pnpm validate` holds Jupiter's apse lines to 30° a
  decade out), while their place along the orbit drifts by tens of millions of
  kilometres within a few years.
- The sky stops at V = 8. Stars between there and Tycho-2's limit near V 11.5 are
  absent from both layers — individually invisible, but the faint background is
  fractionally smoother than the real one.
- Stellar parallax is not modelled. Across the whole solar system it is under an
  arcsecond even for the nearest star, so the sky is the same from Pluto as from
  Earth.
- Illumination falloff is compressed rather than inverse-square, and the sky is
  exposed well above the planets in front of it (see ATTRIBUTION.md).
- Titan's relief is a spline through Cassini RADAR tracks that covered a few
  percent of the surface, so its large-scale shape is measured but no individual
  hill is. Its surface mosaic also carries the frame seams the published product
  has — a consequence of trying to normalise brightness between images taken
  through a scattering atmosphere (see ATTRIBUTION.md).
- No general relativity, no light-time correction, no nutation.
