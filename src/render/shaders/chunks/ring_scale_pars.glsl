/**
 * The uniforms describing the radial remap a ring shares with the moons.
 *
 * A ring is not a decal painted on the planet at some multiple of its radius:
 * it is a population of orbiting bodies, and it has to be remapped as one. Pan
 * orbits *inside* the Encke gap and Daphnis inside the Keeler gap; Prometheus
 * and Pandora straddle the F ring and hold it in place. Scaling rings linearly
 * with the body while scaling moon orbits by the satellite power law drove the
 * two apart by more than 200 scene units at Saturn, which put Pan in the middle
 * of the B ring and left Mimas embedded in the ring sheet. Sending both through
 * the same law puts every shepherd back in its own gap for nothing.
 */
uniform float uParentRadiusKm;
uniform float uBodyScale;
uniform float uSatExponent;
uniform float uSatKnee;
uniform float uScaleBlend;
uniform float uSceneUnitKm;
