/** Mirror of `ScaleModel.satelliteDistance()`. Keep the two in lockstep. */
float ringRadiusToUnits(float km) {
  float x = max(km, 1.0) / uParentRadiusKm;
  float shaped = x <= uSatKnee ? x : uSatKnee * pow(x / uSatKnee, uSatExponent);
  float compressed = uParentRadiusKm * uBodyScale * shaped;
  return mix(km, compressed, uScaleBlend) / uSceneUnitKm;
}
