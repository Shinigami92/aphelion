/** The WebGL renderer and the post-processing chain it draws through. */

import type { FrameState } from './state.ts';
import type { PerspectiveCamera, Scene } from 'three';
import {
  ACESFilmicToneMapping,
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

export class RenderPipeline {
  readonly renderer: WebGLRenderer;

  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
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
    if (this.bloom) {
      this.bloom.enabled = q.bloom;
    }
    this.rebuild();
  }

  rebuild(): void {
    const q = QUALITY[this.state.quality];
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const width = Math.max(1, size.x);
    const height = Math.max(1, size.y);

    this.composer?.dispose();

    const target = new WebGLRenderTarget(width, height, {
      samples: q.msaa,
      colorSpace: SRGBColorSpace,
    });
    const composer = new EffectComposer(this.renderer, target);
    composer.setSize(width, height);

    this.renderPass = new RenderPass(this.scene, this.state.camera!);
    composer.addPass(this.renderPass);

    this.bloom = new UnrealBloomPass(new Vector2(width, height), 0.55, 0.65, 0.72);
    this.bloom.enabled = q.bloom;
    composer.addPass(this.bloom);

    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  resize(width: number, height: number): void {
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, QUALITY[this.state.quality].maxPixelRatio),
    );
    this.renderer.setSize(width, height, false);
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    this.composer?.setSize(size.x, size.y);
    this.bloom?.setSize(size.x, size.y);
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
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
