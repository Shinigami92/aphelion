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
  that works across near/far planes spanning eleven orders of magnitude, and it
  is drawn as directions rather than points (w = 0), so it lies at infinity from
  each eye on its own — which a headset, with two of them, needs.
- **One camera, with a headset riding on it.** In WebXR the eye poses hang off a
  rig that sits where the app camera is and is scaled to decide what a metre of
  head movement spans. In the default diorama scale the camera's near plane
  lands five centimetres from the eyes; since the near plane is already the
  measure of how much room there is, the nearest surface is always a few metres
  away and stereo reads at a human scale. True scale makes a metre a metre.
  Scaling about the eye changes nothing a single eye sees, so the picture is the
  one on screen either way. The composer cannot draw into a WebXR framebuffer,
  so the headset gets the scene straight from the renderer, without bloom: every
  material ends in a shared chunk that applies ACES and the sRGB encoding, which
  Three.js compiles to nothing for the composer's render target and turns on
  only for the screen and XR targets. One difference remains: the additive
  layers (atmospheres, corona, orbit lines) are tone-mapped one by one before
  they add up, not once after, so the brightest haze reads slightly flatter in
  the headset than on screen. The headset layer is multisampled even though the
  canvas is not (see `createContext` in `render/scene/pipeline.ts`). After each
  headset frame the view is drawn once more onto the page, from the head's pose
  through the desktop lens and the full composer, so the page mirrors the wearer
  instead of freezing; it runs at one pixel per CSS pixel to leave the headset
  its frame budget.

## Scripting from the console

`window.aphelion` exposes the running simulation (`time`, `system`, `camera`,
`goTo`, `subPoint`) so a flythrough or a check can be scripted from the console.
