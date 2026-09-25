# What the renderer actually does

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
  terminator and correct forward-scattering haze. Path lengths are measured in
  scale heights rather than scene units, so each body's `density` is its real
  vertical optical depth — Earth's is 0.23, its Rayleigh depth at 440 nm — and it
  means the same thing at true and explore scale.
- **Floating origin.** Everything hangs off one group positioned at the negation
  of the focused body, so the focus sits at render-space zero and float32
  precision is spent where the camera is. Without it you cannot stand on a moon
  of Neptune.
- **Belts on the GPU.** Each particle carries its own orbital elements and Kepler
  is solved in the vertex shader, which is what makes ~74,000 independently
  orbiting bodies affordable.
- **Tiered bodies.** The Sun, planets, dwarf planets and moons above 60 km get
  textured spheres; the other ~600 live in one point cloud and are _promoted_ to
  real geometry on approach. Procedural surfaces are synthesised lazily, one per
  frame, only for bodies that actually get big enough to show one.
- **A real sky.** 41,394 Hipparcos stars as point sources — true position,
  magnitude, and colour from the measured B−V index — over NASA's Gaia-derived
  deep-sky image with the catalogued stars removed, so the two layers reassemble
  the sky without drawing anything twice. Both sit in ICRF/J2000 and are rotated
  into the ecliptic by the obliquity the ephemerides use, so Orion is where Orion
  is. The stars carry their proper motions, so the constellations deform as the
  clock runs across its 1600–2500 range; they do not twinkle, because there is no
  atmosphere out there to make them. The whole backdrop is pinned to the far
  plane in the vertex shader rather than given a radius, which is the only thing
  that works across near/far planes spanning eleven orders of magnitude.

## Scripting from the console

`window.aphelion` exposes the running simulation (`time`, `system`, `camera`,
`goTo`, `subPoint`) so a flythrough or a check can be scripted from the console.
