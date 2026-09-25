precision highp float;

attribute float aA;        // semi-major axis, AU
attribute float aE;
attribute float aInc;      // radians
attribute float aNode;
attribute float aPeri;
attribute float aM0;
attribute float aN;        // radians/day
attribute float aSize;
attribute vec3 aColor;

uniform float uDays;
uniform float uAuKm;
uniform float uSceneUnitKm;
uniform float uBlend;
uniform float uHelioExp;
uniform float uPointScale;
uniform float uPixelRatio;

varying vec3 vColor;
varying float vFade;

// <common> supplies isPerspectiveMatrix(), which the log-depth chunk calls.
#include <common>
#include <logdepthbuf_pars_vertex>

void main() {
  vColor = aColor;

  // Advance the mean anomaly and solve Kepler's equation. Three Newton
  // steps is ample for the eccentricities in these populations.
  float M = aM0 + aN * uDays;
  M = mod(M + 3.14159265, 6.28318531) - 3.14159265;
  float E = M + aE * sin(M) * (1.0 + aE * cos(M));
  for (int i = 0; i < 3; i++) {
    float f = E - aE * sin(E) - M;
    E -= f / max(1.0 - aE * cos(E), 1e-4);
  }

  float aKm = aA * uAuKm;
  float xp = aKm * (cos(E) - aE);
  float yp = aKm * sqrt(max(0.0, 1.0 - aE * aE)) * sin(E);

  float cw = cos(aPeri), sw = sin(aPeri);
  float co = cos(aNode), so = sin(aNode);
  float ci = cos(aInc), si = sin(aInc);

  vec3 posKm = vec3(
    (cw * co - sw * so * ci) * xp + (-sw * co - cw * so * ci) * yp,
    (cw * so + sw * co * ci) * xp + (-sw * so + cw * co * ci) * yp,
    sw * si * xp + cw * si * yp
  );

  // Mirror ScaleModel.heliocentricDistance().
  float r = max(length(posKm), 1.0);
  float compressed = uAuKm * pow(r / uAuKm, uHelioExp);
  float remapped = mix(r, compressed, uBlend);
  vec3 scenePos = posKm * (remapped / r) / uSceneUnitKm;

  // modelViewMatrix, NOT viewMatrix: the swarm hangs off the world group,
  // whose position carries the floating origin. Skipping the model matrix
  // left every particle at its absolute heliocentric coordinate while the
  // rest of the scene had been shifted, so the belts appeared centred on
  // whatever body was focused instead of on the Sun — invisible only when
  // the Sun itself was focused and the shift happened to be zero.
  //
  // Three composes modelViewMatrix on the CPU in double precision, so this
  // is also the more accurate way to reach view space.
  vec4 mv = modelViewMatrix * vec4(scenePos, 1.0);
  gl_Position = projectionMatrix * mv;

  float dist = max(-mv.z, 1e-4);
  gl_PointSize = clamp(aSize * uPointScale * uPixelRatio * 260.0 / dist, 0.9, 5.0);
  // Fade the smallest points instead of letting them alias.
  vFade = clamp(gl_PointSize / 1.4, 0.26, 1.0);

  #include <logdepthbuf_vertex>
}
