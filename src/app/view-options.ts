/** The view panel: which layers are drawn, which orbits, and which scale. */

import type { ScaleModel } from '../core/scale.ts';
import type { SceneView } from '../render/scene.ts';
import type { Toast } from '../ui/panels/toast.ts';
import { TogglePanel } from '../ui/panels/toggle-panel.ts';

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
    [
      {
        label: 'labels',
        get: () => scene.toggles.labels !== 'none',
        set: (v) => {
          scene.toggles.labels = v ? 'major' : 'none';
        },
      },
      {
        label: 'belts',
        get: () => scene.toggles.belts,
        set: (v) => {
          scene.toggles.belts = v;
        },
      },
      {
        label: 'rings',
        get: () => scene.toggles.rings,
        set: (v) => {
          scene.toggles.rings = v;
        },
      },
      {
        label: 'atmospheres',
        get: () => scene.toggles.atmospheres,
        set: (v) => {
          scene.toggles.atmospheres = v;
        },
      },
      // One switch for the whole backdrop — the deep sky and the catalogue stars
      // are two layers of one thing. The URL parameter keeps its old name so
      // links shared before the stars existed still resolve.
      {
        label: 'stars',
        get: () => scene.toggles.milkyway,
        set: (v) => {
          scene.toggles.milkyway = v;
        },
      },
      {
        label: 'minor bodies',
        get: () => scene.toggles.minorBodies,
        set: (v) => {
          scene.toggles.minorBodies = v;
        },
      },
      {
        label: 'Lagrange points',
        get: () => scene.toggles.lagrange,
        set: (v) => {
          deps.setLagrange(v);
        },
      },
    ],
    {
      get: () => scene.toggles.orbits,
      set: (mode) => {
        scene.toggles.orbits = mode;
        togglePanel.refresh();
      },
    },
    {
      get: () => scale.mode,
      set: (mode) => {
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
