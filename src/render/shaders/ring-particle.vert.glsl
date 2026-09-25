attribute vec3 aOffset;   // radial, arc and vertical slot, each in [-1,1]
attribute float aSeed;

uniform sampler2D uProfile;
uniform float uInnerKm;
uniform float uOuterKm;
uniform vec3 uCamRing;    // camera in ring coords: radius km, angle rad, height km
uniform float uPatchR;
uniform float uPatchS;
uniform float uPatchZ;
uniform float uTime;
uniform float uSpin;
uniform float uGmKm;
uniform float uParticleKm;
#include <aphelion_ring_scale_pars>

varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec3 vTint;

#include <common>
#include <logdepthbuf_pars_vertex>
#include <aphelion_ring_to_units>

// Smallest and largest drawn rock, as multiples of the characteristic
// size. The mean lands near 0.8 of it, so the field keeps roughly the
// density a single fixed size gave while gaining a tail of boulders.
const float SIZE_MIN = 0.45;
const float SIZE_MAX = 4.0;

float hash11(float p) { return fract(sin(p * 127.1) * 43758.5453); }

// Cheap value noise on the unit sphere, to make each rock its own shape.
float lumpiness(vec3 dir, float seed) {
  float a = sin(dir.x * 4.1 + seed * 6.3) * sin(dir.y * 3.7 - seed * 2.1);
  float b = sin(dir.z * 5.3 - seed * 4.7) * sin(dir.x * 2.9 + seed * 8.9);
  return 0.72 + 0.28 * (a * 0.6 + b * 0.4);
}

// Spin axes cluster around the orbit normal rather than pointing
// anywhere. A particle in a shear flow is spun up by collisions, and the
// shear picks a sense, so the population ends up mostly prograde about
// the ring's own axis with collisions tilting it and flipping a minority
// retrograde. Uniformly random axes read as chaotic debris; this reads as
// a disc. (Physical spin rates are of order the orbital frequency — one
// turn in ~14 h at Saturn — far too slow to see, so the *rate* below is
// frankly a visual choice, while the axis distribution is not.)
mat3 tumble(float seed, float t) {
  float sense = hash11(seed + 3.3) < 0.15 ? -1.0 : 1.0;
  vec3 axis = normalize(vec3(
    (hash11(seed) - 0.5) * 1.1,
    (hash11(seed + 1.7) - 0.5) * 1.1,
    sense * 1.6
  ));
  float ang = t * (0.05 + hash11(seed + 5.1) * 0.25) + seed * 6.2831;
  float c = cos(ang), s = sin(ang), ic = 1.0 - c;
  return mat3(
    c + axis.x * axis.x * ic,          axis.x * axis.y * ic - axis.z * s, axis.x * axis.z * ic + axis.y * s,
    axis.y * axis.x * ic + axis.z * s, c + axis.y * axis.y * ic,          axis.y * axis.z * ic - axis.x * s,
    axis.z * axis.x * ic - axis.y * s, axis.z * axis.y * ic + axis.x * s, c + axis.z * axis.z * ic
  );
}

void main() {
  // Each rock has a fixed home in the ring, and the field repeats around
  // the camera on a lattice. Snapping to the nearest whole period means a
  // rock's position is *absolute* between jumps: fly at it and it comes
  // to meet you, fly past and it falls behind. Anchoring positions to the
  // camera instead — camRadius + offset — welds the whole field to your
  // eye, so nothing can ever be approached and the ring reads as static
  // no matter how much shear is applied on top.
  float period = 2.0 * uPatchR;
  float rBase = aOffset.x * uPatchR;
  float r = rBase + floor((uCamRing.x - rBase) / period + 0.5) * period;
  if (r < uInnerKm || r > uOuterKm) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  // Density from the ring's own profile: a gap has no particles in it
  // because the same table that drew the gap is what is sampled here.
  float u = (r - uInnerKm) / (uOuterKm - uInnerKm);
  float dens = texture2D(uProfile, vec2(u, 0.5)).a;

  // Only the difference from the camera's own orbital rate is applied, so
  // the camera behaves as a spacecraft in a circular orbit at its own
  // radius: material beside you keeps station and can be flown to, while
  // material inside overtakes and material outside falls behind, at the
  // true rate. Applying the full rate instead sweeps everything past at
  // 16 km/s, which is honest and completely unusable.
  float rc = max(uCamRing.x, 1.0);
  float n = sqrt(uGmKm / (r * r * r));
  float nc = sqrt(uGmKm / (rc * rc * rc));

  // Same lattice trick azimuthally. The angle is formed *then* differenced
  // against the camera, so flying along the ring carries you past rocks
  // rather than dragging them with you.
  float dPeriod = period / max(r, 1.0);
  float dTheta = aOffset.y * 3.14159265 + (n - nc) * uTime - uCamRing.y;
  dTheta -= floor(dTheta / dPeriod + 0.5) * dPeriod;
  float theta = uCamRing.y + dTheta;
  float zKm = aOffset.z * uPatchZ;

  // Into scene units, through the same radial remap the sheet uses.
  float ru = ringRadiusToUnits(r);
  float kmToUnits = ru / max(r, 1.0);
  vec3 centre = vec3(ru * cos(theta), ru * sin(theta), zKm * kmToUnits);

  // Shrink to nothing at the field edge rather than fading, which keeps
  // the material opaque and spares sorting several thousand instances.
  // Measured from the wrapped offsets, not the raw slots, so the taper
  // stays put in space while rocks move through it.
  float edge = max(abs(r - uCamRing.x) / uPatchR, abs(dTheta) / (dPeriod * 0.5));
  // Sizes follow a power law rather than being uniformly jittered, which
  // is what a collisional population actually looks like: mostly gravel,
  // with occasional boulders standing well above it. Occultations put the
  // differential index near 3 across Saturn's rings, so that is the index
  // used, sampled by inverting its cumulative distribution.
  //
  //   n(a) da ~ a^-3 da  =>  a(u) = [ a0^-2 + u (a1^-2 - a0^-2) ]^(-1/2)
  //
  // which is one inversesqrt of a mix. The absolute *range* is exaggerated
  // like everything else here — real particles run centimetres to about
  // ten metres, a spread far too fine to draw — but the shape of the
  // distribution is the real one, and it is what gives the field depth
  // instead of a single repeated pebble size.
  float u01 = hash11(aSeed + 9.1);
  float sizeMul = inversesqrt(
    mix(1.0 / (SIZE_MIN * SIZE_MIN), 1.0 / (SIZE_MAX * SIZE_MAX), u01)
  );
  // Size is an absolute number of kilometres, not a fraction of the
  // patch. That is what lets a rock grow as you close on it; scaling it
  // with the patch held its angular size fixed however near you got.
  float size = uParticleKm * kmToUnits
    * sizeMul
    * (1.0 - smoothstep(0.75, 1.0, edge))
    * smoothstep(0.015, 0.12, dens);

  mat3 spin = tumble(aSeed, uSpin);
  vec3 dir = normalize(position);
  vec3 local = spin * (dir * lumpiness(dir, aSeed) * size);

  vec4 world = modelMatrix * vec4(centre + local, 1.0);
  vWorldPos = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * (spin * dir));
  // Carry the local ring colour so a rock matches the band it sits in.
  vTint = texture2D(uProfile, vec2(clamp(u, 0.0, 1.0), 0.5)).rgb;

  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
