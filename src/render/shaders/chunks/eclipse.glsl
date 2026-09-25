/**
 * Fraction of a disc of angular radius `rSun` hidden behind a disc of angular
 * radius `rOcc` whose centre is `sep` radians away. Exact circle-circle lens
 * area, which is what makes annular versus total eclipses come out right.
 */
float discOverlap(float rSun, float rOcc, float sep) {
  if (sep >= rSun + rOcc) return 0.0;
  if (sep <= rOcc - rSun) return 1.0;                       // total
  if (sep <= rSun - rOcc) return (rOcc * rOcc) / (rSun * rSun); // annular
  float d = max(sep, 1e-7);
  float r = rSun;
  float R = rOcc;
  float d1 = (d * d + r * r - R * R) / (2.0 * d);
  float d2 = d - d1;
  float a1 = r * r * acos(clamp(d1 / r, -1.0, 1.0)) - d1 * sqrt(max(0.0, r * r - d1 * d1));
  float a2 = R * R * acos(clamp(d2 / R, -1.0, 1.0)) - d2 * sqrt(max(0.0, R * R - d2 * d2));
  return clamp((a1 + a2) / (3.14159265 * r * r), 0.0, 1.0);
}

// occluders: xyz = centre in render space, w = radius (0 disables the slot)
float eclipseFactor(vec3 P, vec3 sunPos, float sunRadius, vec4 occ[MAX_OCCLUDERS]) {
  vec3 toSun = sunPos - P;
  float dSun = length(toSun);
  vec3 L = toSun / dSun;
  float rSun = asin(clamp(sunRadius / dSun, 0.0, 1.0));

  float blocked = 0.0;
  for (int i = 0; i < MAX_OCCLUDERS; i++) {
    float radius = occ[i].w;
    if (radius <= 0.0) continue;
    vec3 toOcc = occ[i].xyz - P;
    float dOcc = length(toOcc);
    if (dOcc < 1e-6 || dOcc > dSun) continue;      // behind us or past the Sun
    vec3 D = toOcc / dOcc;
    float cosSep = dot(D, L);
    if (cosSep <= 0.0) continue;                   // on the far side
    float rOcc = asin(clamp(radius / dOcc, 0.0, 1.0));
    float sep = acos(clamp(cosSep, -1.0, 1.0));
    blocked += discOverlap(rSun, rOcc, sep);
  }
  return clamp(1.0 - blocked, 0.0, 1.0);
}
