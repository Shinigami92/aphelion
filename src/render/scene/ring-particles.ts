import type { ScaleModel } from '../../core/scale.ts';
import type { SimBody } from '../../core/system.ts';
import type { FrameState } from './state.ts';
import type { BodyVisual, RingVisual } from './visual.ts';
import type { Group, PerspectiveCamera, ShaderMaterial } from 'three';
import { Matrix4, Mesh, Vector3 } from 'three';
import { SCENE_UNIT_KM } from '../../core/constants.ts';
import { createRingParticleMaterial } from '../materials/ring-particle.ts';
import { textureUniform, vec3Uniform } from '../materials/uniforms.ts';
import { solidTexture } from '../procedural/sprites.ts';
import { createRingParticleGeometry, poleMatrix } from './geometry.ts';
import { gravitationalParameter, ringKmPerUnit, ringParticleSizeKm } from './ring-math.ts';

/** Instanced rocks in the camera-local ring patch. */
const RING_PARTICLE_COUNT = 80000;

/**
 * Largest simulated step the ring clocks will take in one frame, seconds.
 *
 * Time in this app runs to a century per second, at which a literal treatment
 * spins every rock into a strobing blur — so past a point, more rate stops
 * adding information and starts destroying it. Spin saturates early, because a
 * tumbling rock reads as fast long before a shear flow does.
 */
const RING_ORBIT_MAX_RATE = 150;
const RING_SPIN_MAX_RATE = 3.6;

/**
 * Spin runs this many times faster than the clock it is driven by.
 *
 * Real ring particles turn about once in the time they take to orbit — 14 hours
 * at Saturn — so honest spin is invisible at any rate you would actually watch
 * the rings at. Shifting the whole mapping up by a minute-per-second puts the
 * tumble where it reads well at 1 sec/s, and the step cap above still catches
 * everything faster, so the ceiling is unchanged and nothing strobes.
 */
const RING_SPIN_TIME_SCALE = 60;

/** Field half-extent, counted in particle radii. Sets how dense the field looks. */
const RING_FIELD_IN_PARTICLES = 400;

/** Field half-thickness, in particle radii. A ring is a sheet, not a slab. */
const RING_THICKNESS_IN_PARTICLES = 2.5;

/** A ring the camera might be inside, with its distance from the camera in scene units. */
interface NearestRing {
  visual: BodyVisual;
  ring: RingVisual;
  distance: number;
}

// Scratch values, reused every frame so the hot paths do not allocate.
const tmpMatrix = new Matrix4();
const tmpVec = new Vector3();
const tmpVec2 = new Vector3();
const tmpVec3 = new Vector3();

export class RingParticleLayer {
  private ringParticles: Mesh | null = null;
  private ringParticleMaterial: ShaderMaterial | null = null;
  /**
   * Simulated seconds driving ring particle motion, kept as two clocks.
   *
   * Both advance with the *simulation* clock rather than the wall clock, so
   * pausing genuinely stops the rings and running time backwards unwinds them.
   * Both are also rate-limited per frame, which is the whole reason they are
   * separate: at a day per second the true orbital shear is a blur and the
   * tumble is a strobe, so each gets the cap that keeps it legible. Shear can
   * take a much larger step than spin before it stops reading as motion.
   */
  private ringOrbitClock = 0;
  private ringSpinClock = 0;
  /** Previous TT Julian Date, for measuring how much simulated time passed. */
  private lastRingJdTT: number | null = null;

  constructor(private readonly state: FrameState) {}

  /**
   * Whether individual ring particles are on screen.
   *
   * The frame governor needs this. It idles at 10 fps unless the clock is
   * moving fast enough to shift a planet, which is the right call for a solar
   * system — but ring particles spin and shear at 1 sec/s, where nothing else
   * does, and at 10 fps that reads as a stutter rather than as motion.
   */
  get active(): boolean {
    return this.ringParticles?.visible === true;
  }

  /**
   * Move the ring clocks by however much simulated time just passed.
   *
   * Measured from the Julian Date rather than taken from the frame's dt, so it
   * follows the clock's rate and sign for free and needs no knowledge of
   * either. A paused clock advances nothing, which is what stops the rocks.
   */
  advanceClocks(jdTT: number, dt: number): void {
    const previous = this.lastRingJdTT;
    this.lastRingJdTT = jdTT;
    if (previous === null) {
      return;
    }
    const seconds = (jdTT - previous) * 86400;
    const step = Math.max(dt, 1e-4);
    const clamp = (v: number, rate: number): number =>
      Math.max(-rate * step, Math.min(rate * step, v));
    this.ringOrbitClock += clamp(seconds, RING_ORBIT_MAX_RATE);
    this.ringSpinClock += clamp(seconds * RING_SPIN_TIME_SCALE, RING_SPIN_MAX_RATE);
  }

  /**
   * One patch, built once. Which ring it serves is decided per frame.
   *
   * It hangs off the world group rather than a body's group because it is
   * repositioned onto whichever ring has claimed it, and a body group already
   * carries that body's own position.
   */
  build(world: Group): void {
    const material = createRingParticleMaterial({
      profile: solidTexture(0xffffff),
      innerKm: 1,
      outerKm: 2,
      parentRadiusKm: 1,
    });
    const mesh = new Mesh(createRingParticleGeometry(RING_PARTICLE_COUNT), material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 4;
    world.add(mesh);
    this.ringParticles = mesh;
    this.ringParticleMaterial = material;
  }

  /**
   * Populate the ring the camera is actually inside with real geometry.
   *
   * Only one patch exists in the whole scene, and it is claimed by whichever
   * ring the camera is nearest — you can only ever be inside one. It switches
   * ring by having its uniforms repointed, which costs nothing, so there is no
   * pool to manage and no allocation while flying.
   *
   * The patch stays off entirely unless the camera is close enough that a
   * particle would cover more than a pixel or so. Far away the sheet is not
   * merely cheaper, it is more correct: at that distance a real ring *is* a
   * smooth surface, and swapping in a few thousand boulders would misrepresent
   * it as gravel.
   */
  update(
    scale: ScaleModel,
    sunSceneRadius: number,
    visuals: ReadonlyMap<string, BodyVisual>,
  ): void {
    const mesh = this.ringParticles;
    const material = this.ringParticleMaterial;
    const camera = this.state.camera;
    if (!mesh || !material || !camera) {
      return;
    }

    const best = this.nearestRing(scale, visuals, camera);

    // How wide a patch has to be to fill the view, and how big a particle must
    // be drawn to be seen at all. Real ring particles are metres across, which
    // at any scale this app can show is far below a pixel, so the size is an
    // exaggeration — stated in the info panel, like the relief factor.
    // Turn on only once the camera is inside the field's own reach, so the
    // handover to the flat sheet happens exactly where the rocks run out
    // rather than at an unrelated distance.
    if (!best) {
      mesh.visible = false;
      return;
    }
    const outerUnits = scale.satelliteDistance(best.ring.spec.outerKm, best.visual.body.radiusKm);
    const unitsPerKm = outerUnits / best.ring.spec.outerKm;
    const reach = ringParticleSizeKm(best.ring.spec) * RING_FIELD_IN_PARTICLES * unitsPerKm;
    if (best.distance > reach) {
      mesh.visible = false;
      return;
    }

    const { visual, ring } = best;
    const body = visual.body;
    mesh.visible = true;
    this.seatPatch(mesh, material, body, ring, scale, camera);
    this.shadePatch(material, body, ring, scale);
    void sunSceneRadius;
  }

  /** The textured ring closest to the camera, and how far away it is in scene units. */
  private nearestRing(
    scale: ScaleModel,
    visuals: ReadonlyMap<string, BodyVisual>,
    camera: PerspectiveCamera,
  ): NearestRing | null {
    let best: NearestRing | null = null;
    if (this.state.toggles.rings) {
      for (const visual of visuals.values()) {
        for (const ring of visual.rings) {
          if (!ring.spec.bands) {
            continue;
          }
          // Distance from the camera to this ring's annulus, in scene units.
          tmpVec
            .set(visual.body.scene.x, visual.body.scene.y, visual.body.scene.z)
            .sub(this.state.origin);
          const toCam = tmpVec2.copy(camera.position).sub(tmpVec);
          const normal = tmpVec3.set(
            visual.body.orientation.z.x,
            visual.body.orientation.z.y,
            visual.body.orientation.z.z,
          );
          const height = Math.abs(toCam.dot(normal));
          const radial = Math.sqrt(Math.max(toCam.lengthSq() - height * height, 0));
          const innerU = scale.satelliteDistance(ring.spec.innerKm, visual.body.radiusKm);
          const outerU = scale.satelliteDistance(ring.spec.outerKm, visual.body.radiusKm);
          const radialGap =
            radial < innerU ? innerU - radial : radial > outerU ? radial - outerU : 0;
          const distance = Math.hypot(height, radialGap);
          if (!best || distance < best.distance) {
            best = { visual, ring, distance };
          }
        }
      }
    }
    return best;
  }

  private seatPatch(
    mesh: Mesh,
    material: ShaderMaterial,
    body: SimBody,
    ring: RingVisual,
    scale: ScaleModel,
    camera: PerspectiveCamera,
  ): void {
    // Sit the patch in the ring's own plane, then express the camera in that
    // frame: radius, angle and height, all in true kilometres.
    // The patch hangs off the world group, whose own position carries the
    // floating origin — so like every other child here it takes the body's
    // *absolute* scene position. Subtracting the origin as well would shift it
    // by the offset twice, which is invisible whenever the Sun is focused and
    // wrong everywhere else.
    mesh.position.set(body.scene.x, body.scene.y, body.scene.z);
    tmpVec.set(body.scene.x, body.scene.y, body.scene.z).sub(this.state.origin);
    poleMatrix(body.orientation.z, tmpMatrix);
    mesh.quaternion.setFromRotationMatrix(tmpMatrix);

    tmpVec2.copy(camera.position).sub(tmpVec).applyQuaternion(mesh.quaternion.clone().invert());
    const radiusUnits = Math.hypot(tmpVec2.x, tmpVec2.y);
    const kmPerUnit = ringKmPerUnit(radiusUnits, body.radiusKm, scale);
    const camRadiusKm = Math.min(
      Math.max(radiusUnits * kmPerUnit, ring.spec.innerKm),
      ring.spec.outerKm,
    );
    const camAngle = Math.atan2(tmpVec2.y, tmpVec2.x);

    const u = material.uniforms;
    u.uProfile.value = textureUniform(ring.material.uniforms, 'uTex');
    u.uInnerKm.value = ring.spec.innerKm;
    u.uOuterKm.value = ring.spec.outerKm;
    vec3Uniform(u, 'uCamRing').set(camRadiusKm, camAngle, 0);
  }

  private shadePatch(
    material: ShaderMaterial,
    body: SimBody,
    ring: RingVisual,
    scale: ScaleModel,
  ): void {
    const u = material.uniforms;
    // Field extent and rock size are fixed in kilometres for a given ring, and
    // deliberately not tied to how far away the camera is. Sizing them by
    // distance is what made the rocks unreachable: the field shrank as you
    // approached at exactly the rate that kept every rock the same size on
    // screen, so closing on one achieved nothing.
    const particleKm = ringParticleSizeKm(ring.spec);
    const fieldKm = particleKm * RING_FIELD_IN_PARTICLES;
    u.uPatchR.value = fieldKm;
    u.uPatchS.value = fieldKm;
    u.uPatchZ.value = particleKm * RING_THICKNESS_IN_PARTICLES;
    u.uParticleKm.value = particleKm;
    u.uTime.value = this.ringOrbitClock;
    u.uSpin.value = this.ringSpinClock;

    u.uGmKm.value = gravitationalParameter(body);
    // Both in render space: the shader shades against vWorldPos, which the
    // model matrix has already carried out of the ring's local frame.
    vec3Uniform(u, 'uSunPos').copy(this.state.sunRender);
    vec3Uniform(u, 'uPlanetCentre').copy(tmpVec);
    u.uPlanetRadius.value = body.sceneRadius;
    u.uParentRadiusKm.value = body.radiusKm;
    u.uBodyScale.value = scale.params.bodyScale;
    u.uSatExponent.value = scale.params.satelliteExponent;
    u.uSatKnee.value = scale.params.satelliteKnee;
    u.uScaleBlend.value = scale.blendAmount;
    u.uSceneUnitKm.value = SCENE_UNIT_KM;
  }
}
