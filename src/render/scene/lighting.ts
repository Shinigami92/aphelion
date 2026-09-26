/** How the Sun lights a body: distance falloff, sunlight direction and eclipses. */

import type { SimBody } from '../../core/system.ts';
import type { ShaderMaterial, Vector3 } from 'three';
import { AU_KM, SUN_RADIUS_KM } from '../../core/constants.ts';
import { MAX_OCCLUDERS, occluderSlots, vec3Uniform } from '../materials/uniforms.ts';

/**
 * Illumination falloff at a body's distance from the Sun.
 *
 * True irradiance goes as 1/r^2, which puts Saturn at 1% of Earth's brightness
 * and Neptune at 0.1% — rendered literally, the outer system is black. Real
 * eyes adapt; a fixed monitor does not. So the exponent is compressed, which
 * keeps the *ordering* and a real sense of dimming while leaving every planet
 * visible. This is the one deliberately non-physical constant in the renderer.
 *
 * Surfaces and atmospheres both read it from here. They have to agree: a haze
 * lit at full strength around a planet dimmed to 22% reads as a body glowing
 * from within, and tuning nine optical depths against that error would bake the
 * distance dimming into numbers that are supposed to be optical depths.
 */
export function sunIntensity(body: SimBody): number {
  const rKm = Math.max(Math.hypot(body.helioKm.x, body.helioKm.y, body.helioKm.z), 1);
  return Math.min(3, Math.pow(AU_KM / rKm, 0.45));
}

/**
 * Pick the occluders that could actually eclipse this body and hand them to
 * the shader in body-centred kilometres.
 */
export function setEclipseUniforms(material: ShaderMaterial, body: SimBody): void {
  const slots = occluderSlots(material);
  if (slots === undefined) {
    throw new TypeError('[aphelion] eclipse uniforms set on a material without occluder slots');
  }
  for (const slot of slots) {
    slot.set(0, 0, 0, 0);
  }

  const candidates: SimBody[] = [];
  if (body.parent && body.parent.type !== 'star') {
    candidates.push(body.parent);
  }
  if (body.parent) {
    for (const sibling of body.parent.children) {
      if (sibling !== body && sibling.radiusKm > 40) {
        candidates.push(sibling);
      }
    }
  }
  for (const child of body.children) {
    if (child.radiusKm > 40) {
      candidates.push(child);
    }
  }
  if (candidates.length === 0) {
    return;
  }

  // Rank by angular radius as seen from this body: the biggest are the only
  // ones that can meaningfully cover the solar disc.
  const scored = candidates
    .map((c) => {
      const dx = c.helioKm.x - body.helioKm.x;
      const dy = c.helioKm.y - body.helioKm.y;
      const dz = c.helioKm.z - body.helioKm.z;
      const d = Math.max(Math.hypot(dx, dy, dz), 1);
      return { c, dx, dy, dz, angular: c.radiusKm / d };
    })
    .toSorted((a, b) => b.angular - a.angular)
    .slice(0, MAX_OCCLUDERS);

  for (let i = 0; i < scored.length; i++) {
    const s = scored[i];
    slots[i].set(s.dx, s.dy, s.dz, s.c.radiusKm);
  }
}

/** Sunlight, distance falloff and eclipses for a body surface material. */
export function applyLighting(
  material: ShaderMaterial,
  body: SimBody,
  centre: Vector3,
  sunRender: Vector3,
  sunSceneRadius: number,
): void {
  const u = material.uniforms;
  vec3Uniform(u, 'uSunPos').copy(sunRender);
  u.uSunRadius.value = sunSceneRadius;
  vec3Uniform(u, 'uBodyCentre').copy(centre);
  u.uKmPerUnit.value = body.radiusKm / Math.max(body.sceneRadius, 1e-9);
  u.uSunIntensity.value = sunIntensity(body);

  // The Sun in body-centred kilometres.
  vec3Uniform(u, 'uSunPosKm').set(-body.helioKm.x, -body.helioKm.y, -body.helioKm.z);
  u.uSunRadiusKm.value = SUN_RADIUS_KM;

  setEclipseUniforms(material, body);
}
