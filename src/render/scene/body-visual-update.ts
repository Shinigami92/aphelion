/** The per-frame work for one rendered body: placement, lighting, rings and detail. */

import type { ScaleModel } from '../../core/scale.ts';
import type { CloudClock } from './clouds.ts';
import type { FrameState } from './state.ts';
import type { BodyVisual, RingVisual } from './visual.ts';
import type { BufferGeometry } from 'three';
import { BackSide, FrontSide, Matrix4, Quaternion, Vector3 } from 'three';
import { SCENE_UNIT_KM } from '../../core/constants.ts';
import { textureUniform, vec2Uniform, vec3Uniform } from '../materials/uniforms.ts';
import { classifySurface, proceduralSurface, seedFromName } from '../procedural.ts';
import { LOD_SEGMENTS, POLE_AXIS, QUALITY, SHELL_MESH_MARGIN } from './constants.ts';
import { basisToMatrix, poleMatrix } from './geometry.ts';
import { applyLighting, setEclipseUniforms, sunIntensity } from './lighting.ts';

/** What updating a visual needs from the scene. */
export interface VisualContext {
  readonly state: FrameState;
  readonly lodGeometries: ReadonlyArray<BufferGeometry>;
  readonly clouds: CloudClock;
}

// Scratch values, reused every frame so the hot paths do not allocate.
const tmpMatrix = new Matrix4();
const tmpQuat = new Quaternion();
const tmpVec = new Vector3();
const tmpVec2 = new Vector3();

export function updateBodyVisual(
  visual: BodyVisual,
  scale: ScaleModel,
  sunSceneRadius: number,
  ctx: VisualContext,
): void {
  const body = visual.body;
  const group = visual.group;
  group.position.set(body.scene.x, body.scene.y, body.scene.z);

  const radius = body.sceneRadius;
  const squash = 1 - body.flattening;

  // The cloud deck sits 0.4% of a radius up, which is roughly right for Earth
  // until relief is exaggerated 25-fold and the Himalayas stand four times
  // higher than the clouds. Lift the shell just enough to clear the peaks.
  let cloudLift = 1.004;
  if (visual.relief) {
    // Model space is the unit sphere, so one unit of displacement is one body
    // radius: dividing the elevation by the true radius keeps relief in
    // proportion, and it then rides whatever scaling the body itself gets.
    const exaggeration = scale.reliefExaggeration(visual.reliefExaggeration);
    const u = visual.material.uniforms;
    u.uReliefScale.value = exaggeration / body.radiusKm;
    const seg = LOD_SEGMENTS[visual.lod] ?? LOD_SEGMENTS[0];
    vec2Uniform(u, 'uReliefStep').set(1 / seg[0], 1 / seg[1]);
    cloudLift = Math.max(
      cloudLift,
      1 + (visual.relief.maxKm * exaggeration * 1.05) / body.radiusKm,
    );
  }

  basisToMatrix(body.orientation, tmpMatrix);
  visual.mesh.quaternion.setFromRotationMatrix(tmpMatrix);
  visual.mesh.scale.set(radius, radius, radius * squash);

  if (visual.clouds) {
    // The deck is not bolted to the ground. Spin it about the body's own pole
    // — local +Z, which `spinBasis` guarantees, and the same sense in which W
    // advances — by the drift accumulated since J2000, so the offset is a
    // function of the date rather than of how long the tab has been open.
    //
    // Reducing mod 360 keeps the angle small however far the clock has run:
    // Venus reaches a third of a million degrees inside a decade, and while
    // float64 carries that fine, the quaternion does not need to.
    visual.clouds.quaternion.copy(visual.mesh.quaternion);
    if (visual.cloudDrift !== 0) {
      const drift = (((visual.cloudDrift * ctx.state.days) % 360) * Math.PI) / 180;
      visual.clouds.quaternion.multiply(tmpQuat.setFromAxisAngle(POLE_AXIS, drift));
    }
    visual.clouds.scale.set(radius * cloudLift, radius * cloudLift, radius * cloudLift * squash);
  }
  // The shell is a uniformly scaled sphere, so it needs no orientation of its
  // own: the shader gets the pole as a uniform and squashes the march instead.
  const storedRatio: unknown = visual.atmosphere?.userData.shellRatio;
  const shellRatio = typeof storedRatio === 'number' ? storedRatio : 1;
  const shellRadius = radius * shellRatio;
  if (visual.atmosphere) {
    // The mesh only has to generate fragments — the shader intersects the
    // shell analytically. A polygonal sphere is inscribed in the sphere it
    // approximates, so it is scaled a hair proud of `shellRadius`; without
    // that margin the outermost haze is clipped by its own silhouette.
    visual.atmosphere.scale.setScalar(shellRadius * SHELL_MESH_MARGIN);
  }

  // Body centre in render space.
  tmpVec.set(body.scene.x, body.scene.y, body.scene.z).sub(ctx.state.origin);
  const centre = tmpVec;

  applyLighting(visual.material, body, centre, ctx.state.sunRender, sunSceneRadius);
  if (visual.cloudMaterial) {
    const u = visual.cloudMaterial.uniforms;
    vec3Uniform(u, 'uSunPos').copy(ctx.state.sunRender);
    u.uSunRadius.value = sunSceneRadius;
    vec3Uniform(u, 'uBodyCentre').copy(centre);
    u.uKmPerUnit.value = body.radiusKm / Math.max(body.sceneRadius, 1e-9);
    u.uPhaseA.value = ctx.clouds.cloudPhaseA;
    u.uPhaseB.value = ctx.clouds.cloudPhaseB;
    u.uBlend.value = ctx.clouds.cloudBlend;
    setEclipseUniforms(visual.cloudMaterial, body);
  }
  if (visual.atmosphereMaterial) {
    const u = visual.atmosphereMaterial.uniforms;
    vec3Uniform(u, 'uCentre').copy(centre);
    // Both radii in rendered scene units, matching the mesh. Handing the
    // shader the *ratio* here while the mesh sat at 1.08 units inside a
    // 38-unit planet is what kept this shell from drawing a single pixel.
    u.uPlanetRadius.value = radius;
    u.uAtmoRadius.value = shellRadius;
    const pole = body.orientation.z;
    vec3Uniform(u, 'uPole').set(pole.x, pole.y, pole.z);
    u.uSquash.value = squash;
    vec3Uniform(u, 'uSunPos').copy(ctx.state.sunRender);
    u.uSunRadius.value = sunSceneRadius;
    // The same compressed falloff the surface gets, so a planet's haze is
    // never lit more brightly than the planet it belongs to.
    u.uSunIntensity.value = sunIntensity(body);

    // Occlusion depends on which side of the shell the camera is on. Outside,
    // front faces sit in front of the planet and depth-test correctly against
    // anything nearer. Inside, the front faces are behind the eye, and the
    // back faces would be rejected by the planet's own depth — so the test
    // comes off and the shader's clamp at the surface does the work.
    const material = visual.atmosphereMaterial;
    const camera = ctx.state.camera;
    const inside = camera
      ? camera.position.distanceTo(centre) < shellRadius * SHELL_MESH_MARGIN
      : false;
    const side = inside ? BackSide : FrontSide;
    if (material.side !== side) {
      material.side = side;
      material.depthTest = !inside;
      material.needsUpdate = true;
    }
    visual.atmosphere!.visible = ctx.state.toggles.atmospheres;
  }

  // Rings sit in the body's equatorial plane and do not spin with it.
  //
  // The radial remap is handed to the shader rather than baked into the mesh
  // scale, because a ring is a population of orbiting bodies and has to be
  // compressed exactly as the moons are — see GLSL_RING_SCALE_PARS.
  for (const ring of visual.rings) {
    ring.mesh.visible = ctx.state.toggles.rings;
    poleMatrix(body.orientation.z, tmpMatrix);
    ring.mesh.quaternion.setFromRotationMatrix(tmpMatrix);
    const u = ring.material.uniforms;
    vec3Uniform(u, 'uSunPos').copy(ctx.state.sunRender);
    u.uSunRadius.value = sunSceneRadius;
    vec3Uniform(u, 'uPlanetCentre').copy(centre);
    u.uPlanetRadius.value = radius;
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

  // Ring shadow cast onto the planet itself.
  //
  // Pick the ring that actually blocks light rather than rings[0]: for
  // Jupiter that was the Halo, a dust sheet of optical depth 0.035 which was
  // shadowing the planet as hard as Saturn's B ring because the lookup read
  // the profile's alpha and ignored the ring's own opacity entirely.
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

  // Level of detail from apparent size.
  const camera = ctx.state.camera;
  if (camera) {
    const distance = Math.max(camera.position.distanceTo(centre), 1e-6);
    const apparent =
      (radius / distance) * ctx.state.viewport.y * QUALITY[ctx.state.quality].sphereBias;
    // Synthesise the procedural surface the first time a body is actually big
    // enough to show one, capped at one per frame. Most of the ~450 bodies
    // without imagery never get close enough to need one, so this turns a
    // multi-second boot stall into work that is never done at all.
    if (visual.pendingProcedural && apparent > 4 && ctx.state.proceduralBudget > 0) {
      ctx.state.proceduralBudget--;
      visual.pendingProcedural = false;
      visual.material.uniforms.uMap.value = proceduralSurface(`body:${body.key}`, {
        color: body.color,
        radiusKm: body.radiusKm,
        surface:
          body.key === 'io'
            ? 'sulfurous'
            : classifySurface({
                parentKey: body.parent?.key ?? null,
                name: body.name,
                radiusKm: body.radiusKm,
                isMoon: body.type === 'moon',
              }),
        seed: seedFromName(body.key),
      });
      visual.material.needsUpdate = true;
    }

    const lod = apparent > 260 ? 3 : apparent > 70 ? 2 : apparent > 16 ? 1 : 0;
    if (lod !== visual.lod) {
      visual.lod = lod;
      visual.mesh.geometry = ctx.lodGeometries[lod]!;
      if (visual.clouds) {
        visual.clouds.geometry = ctx.lodGeometries[Math.max(1, lod)]!;
      }
      if (visual.atmosphere) {
        visual.atmosphere.geometry = ctx.lodGeometries[Math.max(1, lod)]!;
      }
    }
    // Hide anything smaller than a fraction of a pixel; the point cloud and
    // labels still represent it.
    visual.group.visible =
      apparent > 0.35 || body === ctx.state.focus || body === ctx.state.selected;
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
