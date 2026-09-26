/** The WebGL renderer and the post-processing chain it draws through. */

import type { FrameState } from './state.ts';
import type { PerspectiveCamera, Scene } from 'three';
import {
  ACESFilmicToneMapping,
  HalfFloatType,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { QUALITY } from './constants.ts';

declare global {
  interface Window {
    /**
     * Set by the screenshot suite before the app boots. SwiftShader, the CPU
     * rasteriser it renders on, drops line primitives into a multisampled
     * half-float target — every orbit in some views, and others only when the
     * cores are shared — while real GPUs draw them fine. Rendering the suite
     * without multisampling keeps the lines in its baselines.
     */
    __e2eNoMultisample?: boolean;
  }
}

export class RenderPipeline {
  readonly renderer: WebGLRenderer;

  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly scene: Scene,
    private readonly state: FrameState,
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false, // handled by the composer's multisampled target
      powerPreference: 'high-performance',
      // The scene spans eleven orders of magnitude; a logarithmic depth buffer
      // is the only thing that keeps a ring particle and Neptune in one image.
      logarithmicDepthBuffer: true,
      stencil: false,
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
  }

  /** Apply the quality preset in `state.quality` and rebuild the chain for it. */
  applyQuality(): void {
    const q = QUALITY[this.state.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio));
    this.rebuild();
  }

  rebuild(): void {
    const q = QUALITY[this.state.quality];
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const width = Math.max(1, size.x);
    const height = Math.max(1, size.y);

    this.disposeComposer();

    // The scene is lit in linear HDR: the Sun's disc alone is six times white.
    // An 8-bit target clamps that to 1 before bloom and ACES ever see it, so
    // the chain runs in half floats and stays linear until the OutputPass.
    const target = new WebGLRenderTarget(width, height, {
      samples: window.__e2eNoMultisample === true ? 0 : q.msaa,
      type: HalfFloatType,
    });
    const composer = new EffectComposer(this.renderer, target);
    // Every size handed to the composer is already in drawing-buffer pixels,
    // but it multiplies by the renderer's pixel ratio on its own regardless of
    // the target it was given. Left at the default, the chain and every bloom
    // mip ran at DPR² — sixteen times the CSS pixels at DPR 2 instead of four.
    composer.setPixelRatio(1);

    this.renderPass = new RenderPass(this.scene, this.state.camera!);
    composer.addPass(this.renderPass);

    const bloom = new UnrealBloomPass(new Vector2(width, height), 0.55, 0.65, 0.72);
    bloom.enabled = q.bloom;
    composer.addPass(bloom);

    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  resize(width: number, height: number): void {
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, QUALITY[this.state.quality].maxPixelRatio),
    );
    this.renderer.setSize(width, height, false);
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    // This resizes every pass too, bloom included.
    this.composer?.setSize(size.x, size.y);
  }

  render(camera: PerspectiveCamera): void {
    if (this.renderPass) {
      this.renderPass.camera = camera;
    }
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, camera);
    }
  }

  dispose(): void {
    this.disposeComposer();
    this.renderer.dispose();
  }

  /**
   * The composer only frees its own two targets; the passes own theirs (bloom
   * alone holds eleven mip targets), so without this every rebuild — twice at
   * boot, and again on every quality change — leaked the previous chain.
   */
  private disposeComposer(): void {
    if (!this.composer) {
      return;
    }
    for (const pass of this.composer.passes) {
      pass.dispose();
    }
    this.composer.dispose();
    this.composer = null;
  }
}
