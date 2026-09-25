varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vTangent;
varying vec3 vBitangent;

uniform sampler2D uRelief;
uniform int uHasRelief;
uniform float uReliefMinKm;
uniform float uReliefSpanKm;
uniform float uReliefScale;
uniform vec2 uReliefStep;

// <common> supplies isPerspectiveMatrix(), which the log-depth chunk calls.
#include <common>
#include <logdepthbuf_pars_vertex>

/**
 * Elevation at a uv, as a model-space displacement.
 *
 * The map stores a 16-bit fraction split across red (high byte) and green
 * (low byte), because browsers decode 16-bit PNGs to 8 bits and one part
 * in 255 of Mars's 29 km range is a 115 m step — invisible as an altitude,
 * glaring as a terrace in the normals.
 */
float reliefAt(vec2 uv) {
  vec3 t = texture2D(uRelief, uv).rgb;
  float f = (t.r * 255.0 * 256.0 + t.g * 255.0) / 65535.0;
  return (uReliefMinKm + f * uReliefSpanKm) * uReliefScale;
}

/** The unit-sphere point a uv came from; inverse of createSphere(). */
vec3 sphereAt(vec2 uv) {
  float lon = (uv.x - 0.5) * 6.283185307179586;
  float theta = uv.y * 3.141592653589793;
  float s = sin(theta);
  return vec3(s * cos(lon), s * sin(lon), cos(theta));
}

void main() {
  vUv = uv;
  mat3 normalToWorld = mat3(modelMatrix);

  // Tangent frame from the sphere's own parameterisation: +u runs east
  // along a parallel, and cross(n, T) then points north. Built from the
  // undisplaced normal, because that is the frame normal maps are authored
  // in. Built here because modelMatrix does not exist in the fragment stage.
  vec3 T = normalize(vec3(-normal.y, normal.x, 0.0) + vec3(1e-6, 0.0, 0.0));
  vec3 B = cross(normal, T);
  vTangent = normalize(normalToWorld * T);
  vBitangent = normalize(normalToWorld * B);

  vec3 pos = position;
  vec3 nrm = normal;

  if (uHasRelief == 1) {
    pos = normal * (1.0 + reliefAt(uv));

    // Central differences at the *tessellation's* spacing, not the map's,
    // so the normal describes the surface actually being drawn. Sampling
    // finer than the geometry reads as welcome extra detail right up until
    // relief is exaggerated, at which point texel-scale slopes far exceed
    // anything the triangles do and the surface shades as black speckle.
    // Taking both sides rather than one keeps the normal smooth instead of
    // snapping to each triangle's own face.
    vec2 du = vec2(uReliefStep.x, 0.0);
    vec2 dv = vec2(0.0, uReliefStep.y);
    // Meridians converge to nothing at the poles, so a v offset there stops
    // spanning any area and the cross product collapses. Keep the samples
    // one step inside the map; relief that close to a pole is a few pixels.
    vec2 uvN = vec2(uv.x, clamp(uv.y, uReliefStep.y, 1.0 - uReliefStep.y));
    vec3 e1 = sphereAt(uv + du) * (1.0 + reliefAt(uv + du))
            - sphereAt(uv - du) * (1.0 + reliefAt(uv - du));
    vec3 e2 = sphereAt(uvN + dv) * (1.0 + reliefAt(uvN + dv))
            - sphereAt(uvN - dv) * (1.0 + reliefAt(uvN - dv));

    vec3 n = cross(e1, e2);
    float len = length(n);
    if (len > 1e-12) {
      n /= len;
      // The cross product's sign depends on which way v runs and on the
      // frame's handedness; forcing it outward removes the need to reason
      // about either.
      nrm = dot(n, pos) < 0.0 ? -n : n;
    }
  }

  vNormal = normalize(normalToWorld * nrm);

  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
