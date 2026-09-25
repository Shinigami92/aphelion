/** Ray-sphere intersection; returns (near, far) or (1, -1) when missed. */
vec2 raySphere(vec3 origin, vec3 dir, vec3 centre, float radius) {
  vec3 oc = origin - centre;
  float b = dot(oc, dir);
  float c = dot(oc, oc) - radius * radius;
  float h = b * b - c;
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
