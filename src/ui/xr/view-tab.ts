/**
 * The View tab: what is drawn, at which scale, and where this panel sits.
 *
 * The layer switches are the page's own (`layerToggles` in
 * app/view-options.ts), so both UIs change the same scene state; every change
 * refreshes the page's panel too, which keeps the two in step.
 */

import type { ScaleMode, ScaleModel } from '../../core/scale.ts';
import type { SceneView } from '../../render/scene.ts';
import type { LabelMode, OrbitMode } from '../../render/scene/types.ts';
import type { XrScale } from '../../render/scene/xr-rig.ts';
import type { Tab } from './panel.ts';
import type { Placement } from './placement.ts';
import { Container } from '@pmndrs/uikit';
import { layerToggles } from '../../app/view-options.ts';
import { PLACEMENTS } from './placement.ts';
import { SCROLL } from './theme.ts';
import { Button, row, title } from './widgets.ts';

/** What the View tab reads and changes. */
export interface ViewTabDeps {
  scene: SceneView;
  scale: ScaleModel;
  setLagrange: (on: boolean) => void;
  refreshViewOptions: () => void;
  placement: () => Placement;
  setPlacement: (placement: Placement) => void;
}

function section(name: string, content: Container): Container {
  const node = new Container({ flexDirection: 'column', gap: 6, flexShrink: 0 });
  node.add(title(name), content);
  return node;
}

/**
 * One segmented choice: a button per option, lit while it is the current one.
 * `label` names an option on its button.
 */
function choice<T extends string>(
  options: ReadonlyArray<T>,
  current: () => T,
  choose: (option: T) => void,
  label: (option: T) => string = (option) => option,
): Button[] {
  return options.map(
    (option) =>
      new Button(
        label(option),
        () => {
          choose(option);
        },
        { grow: true, active: (): boolean => current() === option },
      ),
  );
}

/** The layer switches. Labels have their own three-way choice below. */
function layers(deps: ViewTabDeps): Button[] {
  return layerToggles(deps.scene, deps.setLagrange)
    .filter((toggle) => toggle.label !== 'labels')
    .map(
      (toggle) =>
        new Button(
          toggle.label,
          () => {
            toggle.set(!toggle.get());
            deps.refreshViewOptions();
          },
          { active: toggle.get },
        ),
    );
}

/** Buttons three to a row. */
function grid(buttons: ReadonlyArray<Button>): Container {
  const node = new Container({ flexDirection: 'row', flexWrap: 'wrap', gap: 4 });
  for (const button of buttons) {
    button.node.setProperties({ width: '32%' });
    node.add(button.node);
  }
  return node;
}

/** The scene and scale choices, each refreshing the page's view panel after a change. */
function sceneChoices(
  deps: ViewTabDeps,
): Record<'labels' | 'orbits' | 'scales' | 'vrScales', Button[]> {
  const { scene, scale } = deps;
  return {
    labels: choice<LabelMode>(
      ['none', 'major', 'all'],
      () => scene.toggles.labels,
      (mode) => {
        scene.toggles.labels = mode;
        deps.refreshViewOptions();
      },
    ),
    orbits: choice<OrbitMode>(
      ['none', 'planets', 'all'],
      () => scene.toggles.orbits,
      (mode) => {
        scene.toggles.orbits = mode;
        deps.refreshViewOptions();
      },
    ),
    scales: choice<ScaleMode>(
      ['explore', 'true'],
      () => scale.mode,
      (mode) => {
        scale.setMode(mode);
        deps.refreshViewOptions();
      },
    ),
    vrScales: choice<XrScale>(
      ['diorama', 'true'],
      () => scene.xr.scale,
      (mode) => {
        scene.xr.scale = mode;
      },
    ),
  };
}

export function createViewTab(deps: ViewTabDeps): Tab {
  const layerButtons = layers(deps);
  const { labels, orbits, scales, vrScales } = sceneChoices(deps);
  const placements = choice<Placement>(PLACEMENTS, deps.placement, deps.setPlacement, (p) =>
    p === 'pinned' ? 'pin' : p,
  );
  const node = new Container({ flexDirection: 'column', gap: 12, ...SCROLL });
  node.add(
    section('Layers', grid(layerButtons)),
    section('Labels', row(labels)),
    section('Orbits', row(orbits)),
    section('Scale', row(scales)),
    section('Headset scale', row(vrScales)),
    section('Panel', row(placements)),
  );
  const buttons = [...layerButtons, ...labels, ...orbits, ...scales, ...vrScales, ...placements];
  return {
    name: 'View',
    node,
    refresh: () => {
      for (const button of buttons) {
        button.refresh();
      }
    },
  };
}
