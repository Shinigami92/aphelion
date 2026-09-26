/**
 * Scene assembly and the render loop's draw side.
 *
 * Three ideas hold this together:
 *
 * 1. **Floating origin.** Everything lives under a single group whose position
 *    is the negation of the focused body's scene position. So the focus is
 *    always at render-space (0,0,0) and float32 precision is spent where the
 *    camera actually is. Without this you cannot stand on a moon of Neptune.
 *
 * 2. **Tiered representation.** The Sun, planets, dwarf planets and moons above
 *    60 km get a textured sphere with its own material. The other ~600 bodies
 *    live in one point cloud, and are *promoted* to a real sphere on demand when
 *    you approach or select one. That keeps 690 simulated bodies affordable
 *    without pre-building 690 meshes and 450 procedural textures.
 *
 * 3. **Analytic shadows.** No shadow maps — they cannot span from ring particles
 *    to Neptune. Eclipses, ring shadows and planet-on-ring shadows are all
 *    solved in closed form in the shaders (see materials/ and shaders/).
 *
 * `SceneView` only coordinates. Each layer of the scene lives in its own file
 * under scene/, and they all read one shared `FrameState` for the camera, the
 * focus, the selection and the floating origin.
 */

import type { ScaleModel } from '../core/scale.ts';
import type { SimBody, SolarSystem } from '../core/system.ts';
import type { VisualContext } from './scene/body-visual-update.ts';
import type { VisualDeps } from './scene/body-visual.ts';
import type { Quality, SceneToggles } from './scene/types.ts';
import type { BodyVisual } from './scene/visual.ts';
import type { TextureLibrary } from './textures.ts';
import type { BufferGeometry, PerspectiveCamera, Vector3 } from 'three';
import { Group, Scene } from 'three';
import { daysSinceJ2000 } from '../astro/timescales.ts';
import { updateBodyVisual } from './scene/body-visual-update.ts';
import { createBodyVisual } from './scene/body-visual.ts';
import { CloudClock } from './scene/clouds.ts';
import { LOD_SEGMENTS, MAJOR_MOON_RADIUS, QUALITY } from './scene/constants.ts';
import { DustLayer } from './scene/dust.ts';
import { createSphere } from './scene/geometry.ts';
import { LabelLayer } from './scene/labels.ts';
import { LagrangeLayer } from './scene/lagrange.ts';
import { MinorPointsLayer } from './scene/minor-points.ts';
import { OrbitLayer } from './scene/orbits.ts';
import { pickBody } from './scene/picking.ts';
import { RenderPipeline } from './scene/pipeline.ts';
import { PromotionLayer } from './scene/promotions.ts';
import { RingParticleLayer } from './scene/ring-particles.ts';
import { FrameState } from './scene/state.ts';
import { SunLayer } from './scene/sun.ts';
import { SwarmLayer } from './scene/swarms.ts';
import { SkyView } from './sky.ts';

export class SceneView {
  readonly scene = new Scene();
  readonly world = new Group();

  private library: TextureLibrary;

  private lodGeometries: BufferGeometry[] = [];

  private sky: SkyView | null = null;

  /** Bodies with a mesh of their own from the start, by key. */
  private visuals = new Map<string, BodyVisual>();

  private readonly state = new FrameState();
  private readonly clouds = new CloudClock();
  private readonly sun = new SunLayer(this.state);
  private readonly minorPoints = new MinorPointsLayer(this.state);
  private readonly swarms = new SwarmLayer(this.state);
  private readonly lagrange = new LagrangeLayer(this.state);
  private readonly orbits = new OrbitLayer(this.state, this.world);
  private readonly dust = new DustLayer();
  private readonly labels = new LabelLayer(this.state);
  private readonly ringParticles = new RingParticleLayer(this.state);
  private readonly promotions: PromotionLayer;
  private readonly visualContext: VisualContext;
  private readonly pipeline: RenderPipeline;

  constructor(canvas: HTMLCanvasElement, library: TextureLibrary) {
    this.library = library;
    this.promotions = new PromotionLayer(this.state, library);

    this.pipeline = new RenderPipeline(canvas, this.scene, this.state);
    this.library.setAnisotropy(this.pipeline.renderer.capabilities.getMaxAnisotropy());

    this.scene.add(this.world);

    // Detail tiers, swapped by apparent size.
    this.lodGeometries = LOD_SEGMENTS.map(([w, h]) => createSphere(w, h));
    this.visualContext = {
      state: this.state,
      lodGeometries: this.lodGeometries,
      clouds: this.clouds,
    };
  }

  /** The layer switches; the UI flips the fields directly. */
  get toggles(): SceneToggles {
    return this.state.toggles;
  }

  /** Camera used for rendering; set by the app each frame. */
  get currentCamera(): PerspectiveCamera | null {
    return this.state.camera;
  }

  set currentCamera(camera: PerspectiveCamera | null) {
    this.state.camera = camera;
  }

  /**
   * Whether individual ring particles are on screen.
   *
   * The frame governor needs this. It idles at 10 fps unless the clock is
   * moving fast enough to shift a planet, which is the right call for a solar
   * system — but ring particles spin and shear at 1 sec/s, where nothing else
   * does, and at 10 fps that reads as a stutter rather than as motion.
   */
  get ringParticlesActive(): boolean {
    return this.ringParticles.active;
  }

  // -- setup ---------------------------------------------------------------

  setLabelHost(host: HTMLElement): void {
    this.labels.setHost(host);
  }

  setQuality(quality: Quality): void {
    this.state.quality = quality;
    // The march length is a compile-time define, so a new preset means a
    // recompile. Visibility is not touched here: updateVisual owns it through
    // the mesh every frame, and writing it onto the material as well left the
    // haze hidden for good after atmospheres were toggled off and back on
    // across a quality change.
    const steps = QUALITY[quality].atmoSteps;
    for (const visual of this.visuals.values()) {
      const material = visual.atmosphereMaterial;
      if (material && material.defines.STEPS !== steps) {
        material.defines.STEPS = steps;
        material.needsUpdate = true;
      }
    }
    this.pipeline.applyQuality();
  }

  /** Build every persistent object in the scene. */
  build(system: SolarSystem): void {
    this.buildSky();
    this.sun.build(system.sun, this.world, this.lodGeometries, this.library);

    const deps: VisualDeps = {
      state: this.state,
      library: this.library,
      lodGeometries: this.lodGeometries,
      world: this.world,
    };
    for (const body of system.bodies) {
      if (body === system.sun) {
        continue;
      }
      if (body.spec) {
        this.visuals.set(body.key, createBodyVisual(body, deps));
      } else if (body.type === 'moon' && body.radiusKm >= MAJOR_MOON_RADIUS) {
        this.visuals.set(body.key, createBodyVisual(body, deps));
      }
    }

    // Everything that did not get its own mesh.
    this.minorPoints.build(
      this.world,
      system.bodies.filter((b) => b !== system.sun && !this.visuals.has(b.key)),
    );
    this.swarms.build(this.world);
    this.lagrange.build(system, this.world);
    this.ringParticles.build(this.world);
    this.dust.build(this.scene);
    this.promotions.build(this.world, this.lodGeometries);
    this.pipeline.rebuild();
  }

  private buildSky(): void {
    // A unit sphere is enough: SkyView pins its vertices to the far plane, so
    // the radius carries no meaning. See src/render/sky.ts.
    this.sky = new SkyView(createSphere(64, 32), this.library);
    // The sky rides with the camera, so it must not sit under the world group —
    // that group carries the floating origin.
    this.scene.add(this.sky.group);
  }

  /** Point the travel dust at the camera's position and speed. See `DustLayer`. */
  updateDust(position: Vector3, velocity: Vector3, dt: number, intensity: number): void {
    this.dust.update(position, velocity, dt, intensity);
  }

  // -- per-frame -----------------------------------------------------------

  update(
    system: SolarSystem,
    scale: ScaleModel,
    focus: SimBody,
    elapsedSeconds: number,
    dt: number,
  ): void {
    const state = this.state;
    state.focus = focus;
    state.proceduralBudget = 1;
    state.days = daysSinceJ2000(system.jdTT);
    state.pixelRatio = this.pipeline.renderer.getPixelRatio();
    this.clouds.advance(system.jdTT, dt);

    // Floating origin.
    state.origin.set(focus.scene.x, focus.scene.y, focus.scene.z);
    this.world.position.set(-state.origin.x, -state.origin.y, -state.origin.z);

    // The Sun in render space.
    state.sunRender.set(-state.origin.x, -state.origin.y, -state.origin.z);
    const sunSceneRadius = system.sun.sceneRadius;

    this.sun.update(system.sun, elapsedSeconds);

    for (const visual of this.visuals.values()) {
      updateBodyVisual(visual, scale, sunSceneRadius, this.visualContext);
    }

    this.ringParticles.advanceClocks(system.jdTT, dt);
    this.ringParticles.update(scale, sunSceneRadius, this.visuals);
    this.promotions.update(scale, sunSceneRadius, this.minorPoints.minorBodies, this.visualContext);
    this.minorPoints.update(this.promotions.promoted);
    this.swarms.update(system, scale);
    this.lagrange.update();
    this.orbits.update(system, scale, dt);
    this.updateSky(system.jdTT);
    this.labels.update(system, this.lagrange.lagrangeBodies);
  }

  private updateSky(jdTT: number): void {
    const camera = this.state.camera;
    if (!this.sky || !camera) {
      return;
    }
    this.sky.visible = this.state.toggles.milkyway;
    this.sky.update(camera, jdTT, this.pipeline.renderer.getPixelRatio());
  }

  // -- interaction ----------------------------------------------------------

  /** Nearest body to a screen position, within a pixel tolerance. See `pickBody`. */
  pick(clientX: number, clientY: number, system: SolarSystem, tolerance = 22): SimBody | null {
    return pickBody(clientX, clientY, system, tolerance, {
      state: this.state,
      sunVisual: this.sun.sunVisual,
      visuals: this.visuals,
      promoted: this.promotions.promoted,
      lagrangeBodies: this.lagrange.lagrangeBodies,
    });
  }

  setSelected(body: SimBody | null): void {
    this.state.selected = body;
  }

  // -- resize / render ------------------------------------------------------

  resize(width: number, height: number, camera: PerspectiveCamera): void {
    this.state.viewport.set(width, height);
    this.pipeline.resize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    this.minorPoints.resize(width, height);
    this.swarms.resize(width, height);
  }

  render(camera: PerspectiveCamera): void {
    this.state.camera = camera;
    this.pipeline.render(camera);
  }

  dispose(): void {
    this.pipeline.dispose();
    for (const geo of this.lodGeometries) {
      geo.dispose();
    }
  }
}
