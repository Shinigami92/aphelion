/**
 * The inverse, for code that starts from a rendered radius — the ring shadow
 * cast on the planet, which gets its radius from a ray-plane hit rather than
 * from a vertex.
 *
 * Exact at both ends of the scale blend, which is where the camera actually
 * sits; the two laws are mixed rather than the equation being inverted, since
 * a partly-blended power law has no closed-form inverse. The error only exists
 * during the ~0.6 s of a scale transition and only moves the shadow's edge.
 */
float ringUnitsToKm(float units) {
  float km = units * uSceneUnitKm;
  float shaped = km / (uParentRadiusKm * uBodyScale);
  float x = shaped <= uSatKnee ? shaped : uSatKnee * pow(shaped / uSatKnee, 1.0 / uSatExponent);
  return mix(km, x * uParentRadiusKm, uScaleBlend);
}
