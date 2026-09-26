/** Building a body's sphere, with its clouds, atmosphere and rings. */

import type { SimBody } from '../../core/system.ts';
import type { AtmosphereSpec, BodySpec, RingSpec } from '../../data/body-spec.ts';
import type { TextureLibrary } from '../textures.ts';
import type { FrameState } from './state.ts';
import type { BodyVisual } from './visual.ts';
import type { BufferGeometry, ShaderMaterial, Texture } from 'three';
import { Group, Mesh } from 'three';
import { MOON_ATMOSPHERES } from '../../data/bodies/moons.ts';
import { RELIEF_EXAGGERATION } from '../../data/bodies/relief.ts';
import { reliefFor } from '../../data/generated/relief.ts';
import { createAtmosphereMaterial } from '../materials/atmosphere.ts';
import { createBodyMaterial } from '../materials/body.ts';
import { createCloudMaterial } from '../materials/cloud.ts';
import { createRingMaterial } from '../materials/ring.ts';
import { seedFromName } from '../procedural/noise.ts';
import { proceduralRing, ringProfile } from '../procedural/rings.ts';
import { solidTexture } from '../procedural/sprites.ts';
import { whenLoaded } from '../textures.ts';
import { zonalFlow } from './clouds.ts';
import { QUALITY } from './constants.ts';
import { createAnnulus } from './geometry.ts';

/**
 * Radial subdivisions per ring. Enough that the power-law remap reads as a
 * curve rather than a fan of chords, and cheap: the whole solar system's rings
 * come to about 3 MB of vertices.
 */
const RING_RADIAL_STEPS = 48;

/** What building a visual needs from the scene. */
export interface VisualDeps {
  readonly state: FrameState;
  readonly library: TextureLibrary;
  readonly lodGeometries: ReadonlyArray<BufferGeometry>;
  /** The floating-origin group every body hangs off. */
  readonly world: Group;
}

/**
 * Published topography, if this body has any. The uniforms stay off until
 * the map is decoded, so the body is a correct ellipsoid in the meantime
 * rather than a briefly deformed one.
 */
function attachRelief(visual: BodyVisual, library: TextureLibrary): void {
  const material = visual.material;
  const relief = reliefFor(visual.body.key);
  if (!relief) {
    return;
  }
  void whenLoaded(library.loadRelief(relief.file), (tex) => {
    const u = material.uniforms;
    u.uRelief.value = tex;
    u.uReliefMinKm.value = relief.minKm;
    u.uReliefSpanKm.value = relief.maxKm - relief.minKm;
    // uReliefStep follows the drawn LOD and is set per frame in updateVisual.
    u.uHasRelief.value = 1;
    visual.relief = relief;
    material.needsUpdate = true;
  });
}

function attachOptionalMap(
  library: TextureLibrary,
  material: ShaderMaterial,
  file: string | undefined,
  slot: string,
  flag: string,
): void {
  if (!library.available(file)) {
    return;
  }
  void whenLoaded(library.load(file), (tex) => {
    tex.flipY = false;
    material.uniforms[slot].value = tex;
    material.uniforms[flag].value = 1;
    material.needsUpdate = true;
  });
}

/** Cloud shell. */
function attachClouds(visual: BodyVisual, spec: BodySpec, deps: VisualDeps): void {
  const library = deps.library;
  const body = visual.body;
  if (!library.available(spec.textures?.clouds)) {
    return;
  }
  // Black placeholder: the shader reads cover from brightness, so an
  // all-black map means "no cloud" and discards until the real one lands.
  const cloudMaterial = createCloudMaterial(solidTexture(0x000000), {
    opacity: body.key === 'venus' ? 1 : 0.9,
  });
  if (spec.cloudWindMs) {
    // The mean rides the same rigid rotation Venus uses, so a body may be
    // given a wind profile *or* a drift but never both — the profile
    // produces its own.
    const flow = zonalFlow(spec.cloudWindMs, body.radiusKm);
    visual.cloudDrift = flow.meanDegPerDay;
    const u = cloudMaterial.uniforms;
    u.uZonalDeg.value = flow.residualDegPerDay;
    u.uHasFlow.value = 1;
  }
  const clouds = new Mesh(deps.lodGeometries[1], cloudMaterial);
  clouds.scale.setScalar(1.004);
  clouds.renderOrder = 2;
  visual.group.add(clouds);
  visual.clouds = clouds;
  visual.cloudMaterial = cloudMaterial;
  void whenLoaded(library.load(spec.textures.clouds), (tex) => {
    tex.flipY = false;
    cloudMaterial.uniforms.uMap.value = tex;
    cloudMaterial.needsUpdate = true;
  });
}

/** Real imagery, if we have any for this body, and the cloud shell that comes with it. */
function attachImagery(visual: BodyVisual, deps: VisualDeps): void {
  const library = deps.library;
  const body = visual.body;
  const material = visual.material;
  const spec = body.spec;
  const mapFile = body.textureFile;
  if (library.available(mapFile)) {
    void whenLoaded(library.load(mapFile), (tex) => {
      material.uniforms.uMap.value = tex;
      material.needsUpdate = true;
    });
  } else {
    visual.pendingProcedural = true;
  }
  if (spec?.textures) {
    attachOptionalMap(library, material, spec.textures.night, 'uNightMap', 'uHasNight');
    attachOptionalMap(library, material, spec.textures.normal, 'uNormalMap', 'uHasNormal');
    attachOptionalMap(library, material, spec.textures.specular, 'uSpecularMap', 'uHasSpecular');

    attachClouds(visual, spec, deps);
  }
}

/** Atmosphere shell. */
function attachAtmosphere(visual: BodyVisual, atmo: AtmosphereSpec, deps: VisualDeps): void {
  const body = visual.body;
  const shellRatio = 1 + (atmo.thicknessKm * 5) / body.radiusKm;
  const atmoMaterial = createAtmosphereMaterial({
    planetRadius: 1,
    atmosphereRadius: shellRatio,
    rayleigh: atmo.rayleigh,
    mie: atmo.mie,
    density: atmo.density,
    steps: QUALITY[deps.state.quality].atmoSteps,
  });
  const shell = new Mesh(deps.lodGeometries[1], atmoMaterial);
  // The ratio is the only part of the shell that is constant. Its scene
  // radius has to be recomputed every frame, because the body's rendered
  // radius moves with the explore/true blend — so it is stashed here and
  // applied in updateVisual rather than baked into the scale now.
  shell.userData.shellRatio = shellRatio;
  shell.renderOrder = 3;
  visual.group.add(shell);
  visual.atmosphere = shell;
  visual.atmosphereMaterial = atmoMaterial;
}

function attachRing(visual: BodyVisual, ring: RingSpec, library: TextureLibrary): void {
  const body = visual.body;
  // Published radial structure wins over noise. It is also the stand-in
  // while Saturn's photometric strip loads, so the gaps never jump.
  const texture: Texture = ring.bands
    ? ringProfile(`ring:${body.key}:${ring.name}`, {
        bands: ring.bands,
        innerKm: ring.innerKm,
        outerKm: ring.outerKm,
      })
    : proceduralRing(`ring:${body.key}:${ring.name}`, {
        color: ring.opacity > 0.1 ? 0xbfae92 : 0x8f8878,
        seed: seedFromName(`${body.key}${ring.name}`),
        gaps: 3,
        sharpness: 3.2,
      });
  const ringMaterial = createRingMaterial({
    texture,
    innerKm: ring.innerKm,
    outerKm: ring.outerKm,
    opacity: ring.opacity,
    parentRadiusKm: body.radiusKm,
  });
  const ringMesh = new Mesh(
    createAnnulus(ring.innerKm, ring.outerKm, 512, RING_RADIAL_STEPS),
    ringMaterial,
  );
  // The shader places vertices in scene units itself, so the mesh must
  // not also be scaled by the body radius the way the sphere is.
  ringMesh.scale.setScalar(1);
  // ...which also means the geometry's own bounds describe a unit circle
  // rather than the ring. Left to cull itself, a ring would vanish the
  // moment the planet's centre left the screen — precisely when you are
  // flying through it.
  ringMesh.frustumCulled = false;
  ringMesh.renderOrder = 4;
  visual.group.add(ringMesh);
  visual.rings.push({ mesh: ringMesh, material: ringMaterial, spec: ring });

  if (library.available(ring.texture)) {
    void whenLoaded(library.load(ring.texture), (tex) => {
      tex.flipY = false;
      ringMaterial.uniforms.uTex.value = tex;
      ringMaterial.needsUpdate = true;
    });
  }
}

/** Build a full sphere visual (mesh + optional clouds, atmosphere, rings). */
export function createBodyVisual(body: SimBody, deps: VisualDeps): BodyVisual {
  const group = new Group();

  // Start flat, in the body's own colour, so nothing is ever black and boot
  // never blocks. Real imagery is swapped in when it downloads; bodies with no
  // imagery get a procedural surface synthesised lazily (see updateVisual).
  const spec = body.spec;
  // Satellites carry no BodySpec, so Titan — the one moon with an atmosphere
  // thick enough to see — reaches its own shell through a separate table.
  const atmo = spec?.atmosphere ?? (body.type === 'moon' ? MOON_ATMOSPHERES[body.name] : undefined);
  const material = createBodyMaterial({
    map: solidTexture(body.color),
    // Only set where a panchromatic source needs colourising.
    tint: spec?.textureTint ?? 0xffffff,
    rimColor: atmo ? atmo.groundTint : null,
    rimStrength: atmo ? 0.5 : 0,
    shininess: 70,
  });
  const mesh = new Mesh(deps.lodGeometries[1], material);
  group.add(mesh);

  const visual: BodyVisual = {
    body,
    group,
    mesh,
    material,
    clouds: null,
    cloudMaterial: null,
    cloudDrift: spec?.cloudDriftDegPerDay ?? 0,
    atmosphere: null,
    atmosphereMaterial: null,
    rings: [],
    lod: 1,
    pendingProcedural: false,
    relief: null,
    reliefExaggeration: RELIEF_EXAGGERATION[body.key] ?? 1,
  };

  attachRelief(visual, deps.library);
  attachImagery(visual, deps);
  if (atmo) {
    attachAtmosphere(visual, atmo, deps);
  }
  for (const ring of spec?.rings ?? []) {
    attachRing(visual, ring, deps.library);
  }

  deps.world.add(group);
  return visual;
}
