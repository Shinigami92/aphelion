/** The view panel: which layers are drawn, which orbits, and which scale. */

import type { ScaleModel } from '../core/scale.ts';
import type { SceneView } from '../render/scene.ts';
import type { Toast } from '../ui/panels/toast.ts';
import type { ToggleConfig } from '../ui/panels/toggle-panel.ts';
import { TogglePanel } from '../ui/panels/toggle-panel.ts';

/** A checkbox bound straight to one of the scene's on/off toggles. */
function flag(
  scene: SceneView,
  label: string,
  key: 'belts' | 'rings' | 'atmospheres' | 'milkyway' | 'minorBodies',
): ToggleConfig {
  return {
    label,
    get: () => scene.toggles[key],
    set: (v) => {
      scene.toggles[key] = v;
    },
  };
}

/** The layer checkboxes, each reading and writing one of the scene's toggles. */
function layerToggles(scene: SceneView, setLagrange: (on: boolean) => void): ToggleConfig[] {
  return [
    {
      label: 'labels',
      get: () => scene.toggles.labels !== 'none',
      set: (v) => {
        scene.toggles.labels = v ? 'major' : 'none';
      },
    },
    flag(scene, 'belts', 'belts'),
    flag(scene, 'rings', 'rings'),
    flag(scene, 'atmospheres', 'atmospheres'),
    // One switch for the whole backdrop — the deep sky and the catalogue stars
    // are two layers of one thing. The URL parameter keeps its old name so
    // links shared before the stars existed still resolve.
    flag(scene, 'stars', 'milkyway'),
    flag(scene, 'minor bodies', 'minorBodies'),
    {
      label: 'Lagrange points',
      get: () => scene.toggles.lagrange,
      set: (v) => {
        setLagrange(v);
      },
    },
  ];
}

export function createViewOptions(
  host: HTMLElement,
  deps: {
    scene: SceneView;
    scale: ScaleModel;
    toast: Toast;
    setLagrange: (on: boolean) => void;
  },
  repoUrl: string,
): TogglePanel {
  const { scene, scale, toast } = deps;
  const togglePanel = new TogglePanel(
    host,
    layerToggles(scene, deps.setLagrange),
    {
      get: (): string => scene.toggles.orbits,
      set: (mode): void => {
        scene.toggles.orbits = mode;
        togglePanel.refresh();
      },
    },
    {
      get: (): string => scale.mode,
      set: (mode): void => {
        scale.setMode(mode);
        togglePanel.refresh();
        toast.show(
          mode === 'true'
            ? 'True scale — 1:1'
            : 'Explore scale — bodies enlarged, distances compressed',
        );
      },
    },
    repoUrl,
  );
  return togglePanel;
}
