/** The per-frame ring work for one rendered body: its rings, and the shadow they cast on it. */

import type { ScaleModel } from '../../core/scale.ts';
import type { VisualContext } from './body-visual-update.ts';
import type { BodyVisual, RingVisual } from './visual.ts';
import { Matrix4, Vector3 } from 'three';
import { SCENE_UNIT_KM } from '../../core/constants.ts';
import { textureUniform, vec3Uniform } from '../materials/uniforms.ts';
import { poleMatrix } from './geometry.ts';

// Scratch values, reused every frame so the hot paths do not allocate.
const tmpMatrix = new Matrix4();
const tmpVec2 = new Vector3();

/**
 * Rings sit in the body's equatorial plane and do not spin with it.
 *
 * The radial remap is handed to the shader rather than baked into the mesh
 * scale, because a ring is a population of orbiting bodies and has to be
 * compressed exactly as the moons are — see GLSL_RING_SCALE_PARS.
 */
export function shadeRings(
  visual: BodyVisual,
  centre: Vector3,
  scale: ScaleModel,
  sunSceneRadius: number,
  ctx: VisualContext,
): void {
  const body = visual.body;
  for (const ring of visual.rings) {
    ring.mesh.visible = ctx.state.toggles.rings;
    poleMatrix(body.orientation.z, tmpMatrix);
    ring.mesh.quaternion.setFromRotationMatrix(tmpMatrix);
    const u = ring.material.uniforms;
    vec3Uniform(u, 'uSunPos').copy(ctx.state.sunRender);
    u.uSunRadius.value = sunSceneRadius;
    vec3Uniform(u, 'uPlanetCentre').copy(centre);
    u.uPlanetRadius.value = body.sceneRadius;
    u.uParentRadiusKm.value = body.radiusKm;
    u.uBodyScale.value = scale.params.bodyScale;
    u.uSatExponent.value = scale.params.satelliteExponent;
    u.uSatKnee.value = scale.params.satelliteKnee;
    u.uScaleBlend.value = scale.blendAmount;
    u.uSceneUnitKm.value = SCENE_UNIT_KM;
    u.uExploreBoost.value = ring.spec.exploreBoost ?? 1;
    u.uExploreBrightness.value = ring.spec.exploreBrightness ?? 1;
    tmpVec2.set(body.orientation.z.x, body.orientation.z.y, body.orientation.z.z);
    vec3Uniform(u, 'uNormal').copy(tmpVec2);
  }
}

/**
 * The ring that casts the shadow worth drawing.
 *
 * Only one ring can be handed to the body shader, and the list order is
 * inward-out, not densest-first. Jupiter's rings[0] is the Halo — a dust
 * sheet you can see stars through — while the Main ring five times denser
 * sits behind it in the list.
 */
function densestRing(visual: BodyVisual): RingVisual | null {
  let best: RingVisual | null = null;
  for (const ring of visual.rings) {
    if (!best || ring.spec.opacity > best.spec.opacity) {
      best = ring;
    }
  }
  return best;
}

/**
 * Ring shadow cast onto the planet itself.
 *
 * Pick the ring that actually blocks light rather than rings[0]: for
 * Jupiter that was the Halo, a dust sheet of optical depth 0.035 which was
 * shadowing the planet as hard as Saturn's B ring because the lookup read
 * the profile's alpha and ignored the ring's own opacity entirely.
 */
export function shadeRingShadow(visual: BodyVisual, scale: ScaleModel, ctx: VisualContext): void {
  const body = visual.body;
  const mainRing = densestRing(visual);
  if (mainRing && ctx.state.toggles.rings) {
    const u = visual.material.uniforms;
    u.uRingEnabled.value = 1;
    u.uRingTex.value = textureUniform(mainRing.material.uniforms, 'uTex');
    u.uRingInnerKm.value = mainRing.spec.innerKm;
    u.uRingOuterKm.value = mainRing.spec.outerKm;
    u.uRingOpacity.value = mainRing.spec.opacity;
    vec3Uniform(u, 'uRingNormal').set(
      body.orientation.z.x,
      body.orientation.z.y,
      body.orientation.z.z,
    );
    u.uParentRadiusKm.value = body.radiusKm;
    u.uBodyScale.value = scale.params.bodyScale;
    u.uSatExponent.value = scale.params.satelliteExponent;
    u.uSatKnee.value = scale.params.satelliteKnee;
    u.uScaleBlend.value = scale.blendAmount;
    u.uSceneUnitKm.value = SCENE_UNIT_KM;
  } else {
    visual.material.uniforms.uRingEnabled.value = 0;
  }
}
