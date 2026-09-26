/** The public scripting handle, `window.aphelion`. */

import type { CameraController } from '../controls/camera.ts';
import type { ScaleModel } from '../core/scale.ts';
import type { SimBody, SolarSystem } from '../core/system.ts';
import type { TimeController } from '../core/time.ts';
import type { SceneView } from '../render/scene.ts';

/** The point on a body's surface directly beneath another body, in its rotating frame. */
export interface SubPoint {
  lonDeg: number;
  latDeg: number;
}

/**
 * A small public handle on the running simulation.
 *
 * Exposed deliberately: it makes the app checkable from the console or a test
 * harness ("put the clock at the 2024 eclipse and tell me where the umbra
 * falls") without reaching into module internals, and it is genuinely useful
 * for anyone who wants to script a flythrough.
 */
declare global {
  interface Window {
    aphelion: {
      time: TimeController;
      system: SolarSystem;
      scale: ScaleModel;
      scene: SceneView;
      camera: CameraController;
      /** The body the camera orbits. Change it with goTo(), never by assignment. */
      readonly focus: SimBody;
      select: (key: string) => SimBody | null;
      goTo: (key: string) => SimBody | null;
      /** Sub-solar and sub-lunar longitude/latitude, for eclipse checks. */
      subPoint: (bodyKey: string, targetKey: string) => SubPoint | null;
    };
  }
}

export interface ScriptingDeps {
  time: TimeController;
  system: SolarSystem;
  scale: ScaleModel;
  scene: SceneView;
  camera: CameraController;
  focused: () => SimBody;
  select: (body: SimBody) => void;
  goTo: (body: SimBody) => void;
}

export function installScriptingHandle(deps: ScriptingDeps): void {
  const { system } = deps;
  window.aphelion = {
    time: deps.time,
    system,
    scale: deps.scale,
    scene: deps.scene,
    camera: deps.camera,
    get focus(): SimBody {
      return deps.focused();
    },
    select: (key): SimBody | null => {
      const body = system.byKey.get(key);
      if (body) {
        deps.select(body);
      }
      return body ?? null;
    },
    goTo: (key): SimBody | null => {
      const body = system.byKey.get(key);
      if (body) {
        deps.select(body);
        deps.goTo(body);
      }
      return body ?? null;
    },
    subPoint: (bodyKey, targetKey): SubPoint | null => {
      const body = system.byKey.get(bodyKey);
      const target = system.byKey.get(targetKey);
      if (!body || !target) {
        return null;
      }
      // Direction from the body to the target, in the body's rotating frame.
      const d = {
        x: target.helioKm.x - body.helioKm.x,
        y: target.helioKm.y - body.helioKm.y,
        z: target.helioKm.z - body.helioKm.z,
      };
      const o = body.orientation;
      const x = o.x.x * d.x + o.x.y * d.y + o.x.z * d.z;
      const y = o.y.x * d.x + o.y.y * d.y + o.y.z * d.z;
      const z = o.z.x * d.x + o.z.y * d.y + o.z.z * d.z;
      const r = Math.hypot(x, y, z) || 1;
      return {
        lonDeg: (Math.atan2(y, x) * 180) / Math.PI,
        latDeg: (Math.asin(z / r) * 180) / Math.PI,
      };
    },
  };
}
